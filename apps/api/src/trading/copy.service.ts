import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { CopyExecution, CopySubscription, Trade, User } from '@magura/db';
import { CHAINS, type ChainId } from '@magura/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService, RedisService } from '../common/infra.module';
import { NotificationsService } from '../notifications/notifications.module';
import { RealtimeService } from '../realtime/realtime.service';
import { computePnl } from './pnl';
import { TradingService } from './trading.service';
import { SignerService } from './signer.service';

/** Tokens older/bigger than this are "established"; everything else counts as a memecoin for the filter. */
const ESTABLISHED_MC_USD = 10_000_000;
const DEFAULT_PROPORTION = 0.05; // when the leader didn't report a portfolio value

@Injectable()
export class CopyService implements OnModuleInit {
  private readonly log = new Logger('copy');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly trading: TradingService,
    private readonly notify: NotificationsService,
    private readonly rt: RealtimeService,
    private readonly auth: AuthService,
    private readonly signer: SignerService,
  ) {}

  onModuleInit() {
    this.trading.onConfirmed((t, meta) => this.onTradeConfirmed(t, meta));
  }

  // ───────────── subscriptions ─────────────

  async subscribe(copier: User, leaderHandle: string, input: Partial<CopySubscription> & { chains?: ChainId[] }) {
    const leader = await this.prisma.db.user.findUnique({ where: { handle: leaderHandle.toLowerCase() }, include: { settings: true } });
    if (!leader) throw new NotFoundException('leader_not_found');
    if (leader.id === copier.id) throw new BadRequestException('cannot_copy_self');
    if (leader.settings && !leader.settings.copyable) throw new ForbiddenException('leader_not_copyable');
    const d = await this.prisma.db.userSettings.upsert({ where: { userId: copier.id }, update: {}, create: { userId: copier.id } });
    const data = {
      mode: input.mode ?? 'proportional',
      budgetUsd: input.budgetUsd ?? d.copyBudgetUsd,
      fixedAmountUsd: input.fixedAmountUsd ?? null,
      maxPerBuyUsd: input.maxPerBuyUsd ?? d.copyMaxPerBuyUsd,
      stopLossPct: input.stopLossPct ?? d.copyStopLossPct,
      copySells: input.copySells ?? d.copySells,
      memecoins: input.memecoins ?? d.copyMemecoins,
      buyExisting: input.buyExisting ?? d.copyBuyExisting,
      confirmAboveUsd: input.confirmAboveUsd ?? d.copyConfirmAboveUsd,
      chains: input.chains ?? [],
      status: 'active',
      stoppedReason: null,
    };
    const sub = await this.prisma.db.copySubscription.upsert({
      where: { leaderId_copierId: { leaderId: leader.id, copierId: copier.id } },
      update: data,
      create: { ...data, leaderId: leader.id, copierId: copier.id },
    });
    await this.notify.notify(leader.id, 'copy', 'New copier', `@${copier.handle} started copying you`, `/u/${copier.handle}`);
    return sub;
  }

  async setStatus(copier: User, id: string, status: 'active' | 'paused' | 'stopped') {
    const sub = await this.prisma.db.copySubscription.findFirst({ where: { id, copierId: copier.id } });
    if (!sub) throw new NotFoundException();
    return this.prisma.db.copySubscription.update({ where: { id }, data: { status, stoppedReason: status === 'stopped' ? 'user' : null } });
  }

  async stopAll(copier: User) {
    await this.prisma.db.copySubscription.updateMany({ where: { copierId: copier.id, status: 'active' }, data: { status: 'paused' } });
    return { ok: true };
  }

  mine(copier: User) {
    return this.prisma.db.copySubscription.findMany({
      where: { copierId: copier.id, status: { not: 'stopped' } },
      include: { leader: { select: { handle: true, avatarUrl: true, displayName: true } }, _count: { select: { executions: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  pendingConfirmations(copier: User) {
    return this.prisma.db.copyExecution.findMany({
      where: { status: 'awaiting_confirm', subscription: { copierId: copier.id } },
      include: { subscription: { include: { leader: { select: { handle: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ───────────── engine ─────────────

  private async onTradeConfirmed(trade: Trade, meta: { pct?: number; portfolioUsd?: number }) {
    if (trade.source === 'copy') return; // never cascade copies of copies
    const subs = await this.prisma.db.copySubscription.findMany({ where: { leaderId: trade.userId, status: 'active' } });
    if (!subs.length) return;
    const token = await this.prisma.db.token.findUnique({ where: { chain_address: { chain: trade.chain, address: trade.tokenAddress } } });
    const isMeme = !token || !!token.launchpad || (token.marketCapUsd ?? 0) < ESTABLISHED_MC_USD;
    const leaderUsd = trade.amountUsd ? Number(trade.amountUsd) : 0;
    for (const sub of subs) {
      try {
        await this.fanOut(sub, trade, { isMeme, leaderUsd, ...meta });
      } catch (e) {
        this.log.warn(`sub ${sub.id}: ${(e as Error).message}`);
      }
    }
  }

  private async fanOut(sub: CopySubscription, trade: Trade, ctx: { isMeme: boolean; leaderUsd: number; pct?: number; portfolioUsd?: number }) {
    const skip = (reason: string) =>
      this.prisma.db.copyExecution.create({
        data: { subscriptionId: sub.id, leaderTradeId: trade.id, side: trade.side, chain: trade.chain, tokenAddress: trade.tokenAddress, tokenSymbol: trade.tokenSymbol, amountUsd: 0, status: 'skipped', skipReason: reason },
      });
    if (sub.chains.length && !sub.chains.includes(trade.chain)) return skip('chain_filtered');
    if (trade.side === 'sell' && !sub.copySells) return skip('sells_disabled');
    if (trade.side === 'buy' && ctx.isMeme && !sub.memecoins) return skip('memecoins_disabled');

    // auto-stop on drawdown
    const pnl = await this.subscriptionPnl(sub);
    const budget = Number(sub.budgetUsd);
    if (budget > 0 && pnl.realizedUsd <= -(budget * sub.stopLossPct) / 100) {
      await this.prisma.db.copySubscription.update({ where: { id: sub.id }, data: { status: 'stopped', stoppedReason: 'stop_loss' } });
      await this.notify.notify(sub.copierId, 'copy', 'Copying stopped', `Hit your -${sub.stopLossPct}% limit`, '/portfolio');
      return skip('stop_loss');
    }

    let amountUsd = 0;
    if (trade.side === 'buy') {
      const proportion = ctx.portfolioUsd && ctx.portfolioUsd > 0 ? ctx.leaderUsd / ctx.portfolioUsd : DEFAULT_PROPORTION;
      amountUsd = sub.mode === 'fixed' ? Number(sub.fixedAmountUsd ?? 0) : budget * Math.min(1, proportion);
      amountUsd = Math.min(amountUsd, Number(sub.maxPerBuyUsd));
      const deployed = pnl.openPositions.reduce((s, p) => s + p.costUsd, 0);
      amountUsd = Math.min(amountUsd, Math.max(0, budget - deployed));
      if (amountUsd < 1) return skip('budget_exhausted');
    } else {
      const open = pnl.openPositions.find((p) => p.tokenKey === `${trade.chain}:${trade.tokenAddress}`);
      if (!open) return skip('no_position');
      amountUsd = open.costUsd * ((ctx.pct ?? 100) / 100);
    }

    const exec = await this.prisma.db.copyExecution
      .create({
        data: {
          subscriptionId: sub.id,
          leaderTradeId: trade.id,
          side: trade.side,
          chain: trade.chain,
          tokenAddress: trade.tokenAddress,
          tokenSymbol: trade.tokenSymbol,
          amountUsd,
          status: 'queued',
        },
      })
      .catch(() => null); // unique (subscription, leaderTrade) → already handled
    if (!exec) return;

    const leader = await this.prisma.db.user.findUniqueOrThrow({ where: { id: sub.leaderId }, select: { handle: true } });
    const wallet = await this.copierWallet(sub.copierId, trade.chain as ChainId);
    const needsConfirm = !wallet?.delegated || amountUsd > Number(sub.confirmAboveUsd) || !this.auth.privy;
    if (needsConfirm) {
      await this.prisma.db.copyExecution.update({ where: { id: exec.id }, data: { status: 'awaiting_confirm' } });
      this.rt.toUser(sub.copierId, 'copy:confirm', { executionId: exec.id, leader: leader.handle, side: trade.side as 'buy' | 'sell', symbol: trade.tokenSymbol, amountUsd });
      await this.notify.notify(sub.copierId, 'copy', `Confirm copy of @${leader.handle}`, `${trade.side} ${trade.tokenSymbol} for ~$${amountUsd.toFixed(0)}`, '/portfolio');
      return;
    }
    await this.executeDelegated(exec, sub, wallet!, ctx.pct);
  }

  private async copierWallet(userId: string, chain: ChainId) {
    return this.prisma.db.wallet.findFirst({
      where: { userId, chainKind: CHAINS[chain].kind },
      orderBy: [{ delegated: 'desc' }, { isPrimary: 'desc' }],
    });
  }

  /** Server-side execution through the copier's Privy wallet (session signer granted by the user). */
  private async executeDelegated(exec: CopyExecution, sub: CopySubscription, wallet: { address: string; privyWalletId: string | null }, pct?: number) {
    const chain = exec.chain as ChainId;
    await this.prisma.db.copyExecution.update({ where: { id: exec.id }, data: { status: 'executing' } });
    try {
      const amount = await this.amountFor(exec, sub.copierId, chain, pct);
      const q = await this.trading.quote({ chain, side: exec.side as 'buy' | 'sell', token: exec.tokenAddress, amount, slippageBps: 300, wallet: wallet.address, userId: sub.copierId });
      const tx = await this.trading.build(q.quoteId);
      const hash = await this.signer.send(chain, wallet.privyWalletId!, tx);
      const copier = await this.prisma.db.user.findUniqueOrThrow({ where: { id: sub.copierId } });
      await this.trading.record(copier, {
        quoteId: q.quoteId,
        chain,
        side: exec.side as 'buy' | 'sell',
        tokenAddress: exec.tokenAddress,
        tokenSymbol: exec.tokenSymbol,
        txHash: hash,
        source: 'copy',
        copyExecutionId: exec.id,
      });
      await this.prisma.db.copyExecution.update({ where: { id: exec.id }, data: { status: 'done' } });
      this.rt.toUser(sub.copierId, 'copy:executed', { subscriptionId: sub.id, side: exec.side as 'buy' | 'sell', symbol: exec.tokenSymbol, amountUsd: Number(exec.amountUsd), txHash: hash });
    } catch (e) {
      const body = (e as { getResponse?: () => { error?: string; message?: string } }).getResponse?.();
      const lowGas = body?.error === 'low_gas';
      const reason = lowGas ? body!.message! : (e as Error).message;
      await this.prisma.db.copyExecution.update({
        where: { id: exec.id },
        data: { status: lowGas ? 'skipped' : 'failed', skipReason: lowGas ? 'low_gas' : null, error: reason.slice(0, 500) },
      });
      await this.notify.notify(
        sub.copierId,
        'copy',
        lowGas ? 'Copy skipped: low on gas' : 'Copy failed',
        `${exec.side} ${exec.tokenSymbol} from @${(await this.prisma.db.user.findUnique({ where: { id: sub.leaderId }, select: { handle: true } }))?.handle ?? 'leader'}: ${reason.slice(0, 100)}`,
        '/portfolio',
      );
    }
  }

  /** Quote amount: buys in human native units, sells in token base units. */
  private async amountFor(exec: CopyExecution, copierId: string, chain: ChainId, pct?: number): Promise<string> {
    if (exec.side === 'buy') {
      const nUsd = await this.trading.nativeUsd(chain);
      if (!nUsd) throw new Error('no_native_price');
      return (Number(exec.amountUsd) / nUsd).toFixed(chain === 'solana' ? 9 : 12);
    }
    const trades = await this.prisma.db.trade.findMany({
      where: { userId: copierId, chain: exec.chain, tokenAddress: exec.tokenAddress, status: 'confirmed', source: 'copy' },
      orderBy: { createdAt: 'asc' },
    });
    const p = computePnl(trades.map((t) => ({ tokenKey: 'x', side: t.side as 'buy' | 'sell', amountIn: t.amountIn, amountOut: t.amountOut, amountUsd: Number(t.amountUsd ?? 0) })));
    const qty = p.openPositions[0]?.qty ?? 0n;
    return ((qty * BigInt(Math.round((pct ?? 100) * 100))) / 10_000n).toString();
  }

  /** Copier confirms a pending copy in the browser → returns a tx to sign. */
  async confirmBuild(copier: User, executionId: string, wallet: string) {
    const exec = await this.prisma.db.copyExecution.findFirst({ where: { id: executionId, status: 'awaiting_confirm', subscription: { copierId: copier.id } } });
    if (!exec) throw new NotFoundException('execution_not_found');
    const chain = exec.chain as ChainId;
    const amount = await this.amountFor(exec, copier.id, chain);
    const q = await this.trading.quote({ chain, side: exec.side as 'buy' | 'sell', token: exec.tokenAddress, amount, slippageBps: 300, wallet });
    const tx = await this.trading.build(q.quoteId);
    await this.prisma.db.copyExecution.update({ where: { id: exec.id }, data: { status: 'executing' } });
    return { quoteId: q.quoteId, tx, execution: exec };
  }

  async skipExecution(copier: User, executionId: string) {
    await this.prisma.db.copyExecution.updateMany({ where: { id: executionId, subscription: { copierId: copier.id } }, data: { status: 'skipped', skipReason: 'user' } });
    return { ok: true };
  }

  async subscriptionPnl(sub: CopySubscription) {
    const trades = await this.prisma.db.trade.findMany({
      where: { userId: sub.copierId, status: 'confirmed', copyExecution: { subscriptionId: sub.id } },
      orderBy: { createdAt: 'asc' },
    });
    return computePnl(trades.map((t) => ({ tokenKey: `${t.chain}:${t.tokenAddress}`, side: t.side as 'buy' | 'sell', amountIn: t.amountIn, amountOut: t.amountOut, amountUsd: Number(t.amountUsd ?? 0) })));
  }

  // ───────────── leaderboard ─────────────

  async leaderboard(days: number, limit = 50) {
    return this.redis.cached(`lb:${days}`, 60, async () => {
      const since = new Date(Date.now() - days * 86400_000);
      const trades = await this.prisma.db.trade.findMany({
        where: { status: 'confirmed', createdAt: { gte: since }, source: { not: 'copy' }, user: { settings: { copyable: true, publicPnl: true } } },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, chain: true, tokenAddress: true, side: true, amountIn: true, amountOut: true, amountUsd: true },
      });
      const byUser = new Map<string, typeof trades>();
      for (const t of trades) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t]);
      const rows = [...byUser.entries()].map(([userId, ts]) => {
        const p = computePnl(ts.map((t) => ({ tokenKey: `${t.chain}:${t.tokenAddress}`, side: t.side as 'buy' | 'sell', amountIn: t.amountIn, amountOut: t.amountOut, amountUsd: Number(t.amountUsd ?? 0) })));
        return { userId, roiPct: p.roiPct, pnlUsd: p.realizedUsd, winRatePct: p.winRatePct, trades: ts.length };
      });
      const users = await this.prisma.db.user.findMany({
        where: { id: { in: rows.map((r) => r.userId) } },
        select: { id: true, handle: true, displayName: true, avatarUrl: true, badges: true, _count: { select: { copyAsLeader: { where: { status: 'active' } } } } },
      });
      return rows
        .filter((r) => r.roiPct != null)
        .sort((a, b) => (b.roiPct ?? 0) - (a.roiPct ?? 0))
        .slice(0, limit)
        .map((r, i) => {
          const u = users.find((x) => x.id === r.userId)!;
          return { rank: i + 1, ...r, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl, badges: u.badges, copiers: u._count.copyAsLeader };
        });
    });
  }
}

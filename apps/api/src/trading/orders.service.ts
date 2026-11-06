import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { dexscreener, tokenBalance } from '@magura/chains';
import type { OrderRule, User } from '@magura/db';
import { CHAINS, type ChainId } from '@magura/shared';
import { PrismaService, RedisService } from '../common/infra.module';
import { NotificationsService } from '../notifications/notifications.module';
import { RealtimeService } from '../realtime/realtime.service';
import { SignerService } from './signer.service';
import { TradingService } from './trading.service';
import { BUY_KINDS, EVENT_KINDS, shouldArm, shouldFire } from './orders.rules';
import { IntelService } from '../market/intel.service';

export type OrderKind = 'tp' | 'sl' | 'trail' | 'trail_tp' | 'limit_buy' | 'dca' | 'dev_sell' | 'dev_sell_buy' | 'migrate_buy' | 'migrate_sell';

export const ORDER_NAME: Record<OrderKind, string> = {
  tp: 'Take profit',
  sl: 'Stop loss',
  trail: 'Trailing stop',
  trail_tp: 'Trailing take profit',
  limit_buy: 'Limit buy',
  dca: 'DCA',
  dev_sell: 'Sell on dev sell',
  dev_sell_buy: 'Buy on dev sell',
  migrate_buy: 'Buy on migration',
  migrate_sell: 'Sell on migration',
};
const isBuy = (k: string) => (BUY_KINDS as readonly string[]).includes(k);

export interface NewOrder {
  chain: ChainId;
  tokenAddress: string;
  tokenSymbol: string;
  kind: OrderKind;
  triggerPct?: number;
  triggerMcUsd?: number;
  sellPct?: number;
  buyAmount?: string;
  slippageBps?: number;
  armPct?: number;
  intervalSec?: number;
  slices?: number;
  minMcUsd?: number;
}

const MAX_ACTIVE = 50;

/**
 * Take profit, stop loss, trailing stop and limit buys.
 * A watcher checks prices every 10s; when a rule fires it trades through the user's delegated wallet,
 * or — without one — asks the user to confirm in the app.
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly log = new Logger('orders');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly trading: TradingService,
    private readonly signer: SignerService,
    private readonly notify: NotificationsService,
    private readonly rt: RealtimeService,
    private readonly intel: IntelService,
  ) {}

  onModuleInit() {
    // event-driven automations
    this.intel.onDevSell((e) => this.fireEvent(e.chain, e.address, ['dev_sell', 'dev_sell_buy']));
    this.intel.onMigrate((e) => this.fireEvent(e.chain, e.address, ['migrate_buy', 'migrate_sell']));
  }

  private async fireEvent(chain: ChainId, address: string, kinds: string[]) {
    const rules = await this.prisma.db.orderRule.findMany({ where: { status: 'active', chain, tokenAddress: address, kind: { in: kinds } } });
    for (const r of rules) await this.fire(r);
  }

  private async market(chain: ChainId, token: string) {
    const [pair, row] = await Promise.all([
      this.redis.cached(`pair:${chain}:${token}`, 10, () => dexscreener.bestPair(chain, token)).catch(() => null),
      this.prisma.db.token.findUnique({ where: { chain_address: { chain, address: token } } }),
    ]);
    const price = pair?.priceUsd ?? row?.priceUsd ?? null;
    const mcUsd = pair?.marketCap ?? pair?.fdv ?? row?.marketCapUsd ?? null;
    return { price, mcUsd };
  }

  async create(user: User, input: NewOrder[]) {
    const active = await this.prisma.db.orderRule.count({ where: { userId: user.id, status: 'active' } });
    if (active + input.length > MAX_ACTIVE) throw new BadRequestException({ error: 'too_many_orders', message: `Up to ${MAX_ACTIVE} active orders` });
    const out: OrderRule[] = [];
    for (const o of input) {
      const { price, mcUsd } = await this.market(o.chain, o.tokenAddress);
      const needsPrice = !isBuy(o.kind) && !(EVENT_KINDS as readonly string[]).includes(o.kind);
      if (needsPrice && price == null) throw new BadRequestException({ error: 'no_price', message: 'No live price for this coin yet' });
      if (o.kind === 'limit_buy' && mcUsd != null && o.triggerMcUsd! >= mcUsd)
        throw new BadRequestException({ error: 'limit_above_market', message: 'Limit market cap must be below the current market cap' });
      out.push(
        await this.prisma.db.orderRule.create({
          data: {
            userId: user.id,
            chain: o.chain,
            tokenAddress: o.tokenAddress,
            tokenSymbol: o.tokenSymbol,
            kind: o.kind,
            triggerPct: o.kind === 'sl' ? -Math.abs(o.triggerPct!) : o.triggerPct ?? null,
            triggerMcUsd: o.triggerMcUsd ?? null,
            sellPct: o.sellPct ?? null,
            buyAmount: o.buyAmount ?? null,
            slippageBps: o.slippageBps ?? 1500,
            entryPrice: price,
            peakPrice: price,
            armPct: o.armPct ?? null,
            intervalSec: o.intervalSec ?? null,
            slicesTotal: o.slices ?? null,
            nextAt: o.kind === 'dca' ? new Date() : null,
            minMcUsd: o.minMcUsd ?? null,
          },
        }),
      );
    }
    return out;
  }

  list(user: User, token?: { chain: ChainId; address: string }) {
    return this.prisma.db.orderRule.findMany({
      where: { userId: user.id, ...(token ? { chain: token.chain, tokenAddress: token.address } : {}), status: { in: ['active', 'executing', 'awaiting_confirm'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(user: User, id: string) {
    const r = await this.prisma.db.orderRule.updateMany({ where: { id, userId: user.id, status: { in: ['active', 'awaiting_confirm'] } }, data: { status: 'cancelled' } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }

  /** The app executed an order the user had to confirm. DCA keeps going until every slice is bought. */
  async markDone(user: User, id: string, txHash: string | null, skipped = false) {
    const r = await this.prisma.db.orderRule.findFirst({ where: { id, userId: user.id, status: 'awaiting_confirm' } });
    if (!r) return { ok: true };
    const next = r.kind === 'dca' ? this.afterFill(r) : { status: skipped ? 'cancelled' : 'done' };
    await this.prisma.db.orderRule.update({ where: { id }, data: { ...next, txHash } });
    return { ok: true };
  }

  /** After a fill: DCA schedules its next slice; everything else is done. */
  private afterFill(r: OrderRule) {
    if (r.kind !== 'dca') return { status: 'done' };
    const done = r.slicesDone + 1;
    const finished = done >= (r.slicesTotal ?? 1);
    return { slicesDone: done, status: finished ? 'done' : 'active', nextAt: finished ? null : new Date(Date.now() + (r.intervalSec ?? 60) * 1000) };
  }

  @Interval(10_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const rules = await this.prisma.db.orderRule.findMany({ where: { status: 'active', kind: { notIn: [...EVENT_KINDS] } }, take: 2000 });
      const byToken = new Map<string, OrderRule[]>();
      for (const r of rules) {
        const k = `${r.chain}:${r.tokenAddress}`;
        byToken.set(k, [...(byToken.get(k) ?? []), r]);
      }
      for (const [k, group] of byToken) {
        const [chain, token] = k.split(':') as [ChainId, string];
        const { price, mcUsd } = await this.market(chain, token);
        if (price == null) continue;
        for (const r of group) {
          if (shouldArm(r, price)) {
            await this.prisma.db.orderRule.update({ where: { id: r.id }, data: { armed: true, peakPrice: price } });
            r.armed = true;
            r.peakPrice = price;
          }
          if ((r.kind === 'trail' || (r.kind === 'trail_tp' && r.armed)) && price > (r.peakPrice ?? 0)) {
            await this.prisma.db.orderRule.update({ where: { id: r.id }, data: { peakPrice: price } });
            r.peakPrice = price;
          }
          if (shouldFire(r, price, mcUsd)) await this.fire(r);
        }
      }
    } catch (e) {
      this.log.warn(`tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async fire(r: OrderRule) {
    // claim it — two API replicas never fire the same rule
    const claimed = await this.prisma.db.orderRule.updateMany({ where: { id: r.id, status: 'active' }, data: { status: 'executing', triggeredAt: new Date() } });
    if (!claimed.count) return;
    const chain = r.chain as ChainId;
    const side = isBuy(r.kind) ? 'buy' : 'sell';
    const name = ORDER_NAME[r.kind as OrderKind] ?? 'Order';
    const wallet = await this.prisma.db.wallet.findFirst({
      where: { userId: r.userId, chainKind: CHAINS[chain].kind },
      orderBy: [{ delegated: 'desc' }, { isPrimary: 'desc' }],
    });
    if (!wallet) return this.fail(r, 'no_wallet', name);

    // size: sells are a % of what the wallet holds right now
    let amount: string;
    if (side === 'sell') {
      const bal = await tokenBalance(chain, wallet.address, r.tokenAddress).catch(() => null);
      if (!bal || bal.amount === 0n) {
        await this.prisma.db.orderRule.update({ where: { id: r.id }, data: { status: 'cancelled', error: 'no_position' } });
        return;
      }
      const pct = r.sellPct ?? 100;
      amount = pct >= 100 ? bal.amount.toString() : ((bal.amount * BigInt(pct)) / 100n).toString();
    } else amount = r.buyAmount ?? '0';

    if (!wallet.delegated || !wallet.privyWalletId || !this.signer.available) {
      await this.prisma.db.orderRule.update({ where: { id: r.id }, data: { status: 'awaiting_confirm' } });
      this.rt.toUser(r.userId, 'order:fired', { orderId: r.id, kind: r.kind, side, symbol: r.tokenSymbol, chain, token: r.tokenAddress, needsConfirm: true, txHash: null });
      await this.notify.notify(r.userId, 'order', `${name} hit on ${r.tokenSymbol}`, 'Tap to confirm the trade in your wallet', `/t/${chain}/${r.tokenAddress}`);
      return;
    }

    try {
      const q = await this.trading.quote({ chain, side, token: r.tokenAddress, amount, slippageBps: r.slippageBps, wallet: wallet.address, userId: r.userId });
      const tx = await this.trading.build(q.quoteId);
      const hash = await this.signer.send(chain, wallet.privyWalletId, tx);
      const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: r.userId } });
      await this.trading.record(user, { quoteId: q.quoteId, chain, side, tokenAddress: r.tokenAddress, tokenSymbol: r.tokenSymbol, txHash: hash, source: 'order', shareToRoom: false });
      await this.prisma.db.orderRule.update({ where: { id: r.id }, data: { ...this.afterFill(r), txHash: hash } });
      this.rt.toUser(r.userId, 'order:fired', { orderId: r.id, kind: r.kind, side, symbol: r.tokenSymbol, chain, token: r.tokenAddress, needsConfirm: false, txHash: hash });
      await this.notify.notify(r.userId, 'order', `${name} filled on ${r.tokenSymbol}`, side === 'sell' ? `Sold ${r.sellPct ?? 100}% of your position` : `Bought for ${r.buyAmount} ${CHAINS[chain].nativeSymbol}`, `/t/${chain}/${r.tokenAddress}`);
    } catch (e) {
      const body = (e as { getResponse?: () => { message?: string } }).getResponse?.();
      await this.fail(r, (body?.message ?? (e as Error).message).slice(0, 300), name);
    }
  }

  private async fail(r: OrderRule, reason: string, name: string) {
    await this.prisma.db.orderRule.update({ where: { id: r.id }, data: { status: 'failed', error: reason } });
    await this.notify.notify(r.userId, 'order', `${name} on ${r.tokenSymbol} failed`, reason.replace(/_/g, ' '), `/t/${r.chain}/${r.tokenAddress}`);
  }
}

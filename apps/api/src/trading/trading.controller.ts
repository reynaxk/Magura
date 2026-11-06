import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CHAINS } from '@magura/shared';
import { tokenBalance, tokenDecimals } from '@magura/chains';
import type { User } from '@magura/db';
import { CurrentUser, Public } from '../auth/auth.guard';
import { PrismaService, RedisService } from '../common/infra.module';
import { parse, zChain, zMoney } from '../common/zod';
import { computePnl } from './pnl';
import { CopyService } from './copy.service';
import { TradingService } from './trading.service';

@Controller()
export class TradingController {
  constructor(
    private readonly trading: TradingService,
    private readonly copy: CopyService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ───── swaps (spot only) ─────

  @Post('swap/quote')
  quote(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(
      z.object({
        chain: zChain,
        side: z.enum(['buy', 'sell']),
        token: z.string().min(32).max(64),
        amount: z.string().regex(/^\d+(\.\d+)?$/),
        slippageBps: z.number().int().min(10).max(5000).default(100),
        wallet: z.string().min(32).max(64),
        priorityFeeSol: z.number().min(0).max(0.1).optional(),
      }),
      body,
    );
    return this.trading.quote({ ...b, userId: user.id });
  }

  @Post('swap/build')
  build(@Body() body: unknown) {
    const b = parse(z.object({ quoteId: z.string().uuid() }), body);
    return this.trading.build(b.quoteId);
  }

  @Post('trades')
  record(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(
      z.object({
        quoteId: z.string().uuid().optional(),
        chain: zChain,
        side: z.enum(['buy', 'sell']),
        tokenAddress: z.string().min(32).max(64),
        tokenSymbol: z.string().max(20),
        txHash: z.string().min(40).max(100),
        amountUsd: z.number().optional(),
        pct: z.number().min(0).max(100).optional(),
        portfolioUsd: z.number().optional(),
        shareToRoom: z.boolean().optional(),
        source: z.enum(['manual', 'quickbuy', 'call', 'order']).optional(),
        copyExecutionId: z.string().optional(),
      }),
      body,
    );
    return this.trading.record(user, b);
  }

  @Get('me/trades')
  myTrades(@CurrentUser() user: User) {
    return this.prisma.db.trade.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** On-chain balance of one token in the caller's own wallet — powers "sell 25%" buttons. */
  @Get('me/balance')
  async balance(@Query() q: Record<string, string>, @CurrentUser() user: User) {
    const p = parse(z.object({ chain: zChain, token: z.string().min(20).max(80) }), q);
    const kind = CHAINS[p.chain].kind;
    const w = await this.prisma.db.wallet.findFirst({ where: { userId: user.id, chainKind: kind }, orderBy: { isPrimary: 'desc' } });
    if (!w) return { amount: '0', decimals: 0, wallet: null };
    try {
      const b = await tokenBalance(p.chain, w.address, p.token);
      return { amount: b.amount.toString(), decimals: b.decimals, wallet: w.address };
    } catch {
      return { amount: null, decimals: null, wallet: w.address };
    }
  }

  /** Your average entry on one coin (since your last full exit) — the chart's entry line. */
  @Get('me/position/:chain/:token')
  async position(@Param('chain') c: string, @Param('token') tok: string, @CurrentUser() user: User) {
    const chain = parse(zChain, c);
    const token = chain === 'solana' ? tok : tok.toLowerCase();
    const trades = await this.prisma.db.trade.findMany({ where: { userId: user.id, chain, tokenAddress: token, status: 'confirmed' }, orderBy: { createdAt: 'asc' } });
    let qty = 0n;
    let cost = 0;
    let weighted = 0;
    let sold = 0;
    for (const t of trades) {
      if (t.side === 'buy') {
        qty += BigInt(t.amountOut || '0');
        cost += Number(t.amountUsd ?? 0);
        if (t.priceUsd) weighted += Number(t.amountUsd ?? 0) * t.priceUsd;
      } else {
        const s = BigInt(t.amountIn || '0');
        sold += Number(t.amountUsd ?? 0);
        qty = s >= qty ? 0n : qty - s;
        if (qty === 0n) {
          cost = 0;
          weighted = 0;
        }
      }
    }
    const realized = computePnl(trades.map((t) => ({ tokenKey: token, side: t.side as 'buy' | 'sell', amountIn: t.amountIn, amountOut: t.amountOut, amountUsd: Number(t.amountUsd ?? 0) }))).realizedUsd;
    const decimals = qty > 0n ? await this.redis.cached(`dec:${chain}:${token}`, 86_400, () => tokenDecimals(chain, token).catch(() => null)) : null;
    return {
      open: qty > 0n,
      avgPriceUsd: qty > 0n && cost > 0 ? weighted / cost : null,
      costUsd: qty > 0n ? cost : 0,
      soldUsd: sold,
      realizedUsd: realized,
      /** UI units still held (by our trade records) */
      holding: qty > 0n && decimals != null ? Number(qty) / 10 ** decimals : null,
      boughtUsd: trades.filter((t) => t.side === 'buy').reduce((a, t) => a + Number(t.amountUsd ?? 0), 0),
      buys: trades.filter((t) => t.side === 'buy').length,
      sells: trades.filter((t) => t.side === 'sell').length,
      trades: trades
        .slice(-30)
        .reverse()
        .map((t) => ({ id: t.id, side: t.side, amountUsd: Number(t.amountUsd ?? 0), priceUsd: t.priceUsd, txHash: t.txHash, at: t.createdAt.toISOString() })),
    };
  }

  @Get('me/portfolio')
  async portfolio(@CurrentUser() user: User) {
    const trades = await this.prisma.db.trade.findMany({ where: { userId: user.id, status: 'confirmed' }, orderBy: { createdAt: 'asc' } });
    const pnl = computePnl(trades.map((t) => ({ tokenKey: `${t.chain}:${t.tokenAddress}`, side: t.side as 'buy' | 'sell', amountIn: t.amountIn, amountOut: t.amountOut, amountUsd: Number(t.amountUsd ?? 0) })));
    const source = new Map<string, string>();
    for (const t of trades) {
      if (t.side !== 'buy') continue;
      const k = `${t.chain}:${t.tokenAddress}`;
      if (t.copyExecutionId) {
        const e = await this.prisma.db.copyExecution.findUnique({ where: { id: t.copyExecutionId }, include: { subscription: { include: { leader: { select: { handle: true } } } } } });
        if (e) source.set(k, `copy:${e.subscription.leader.handle}`);
      } else if (!source.has(k)) source.set(k, t.source);
    }
    return {
      realizedUsd: pnl.realizedUsd,
      roiPct: pnl.roiPct,
      winRatePct: pnl.winRatePct,
      positions: pnl.openPositions.map((p) => {
        const [chain, address] = p.tokenKey.split(':');
        const sym = trades.find((t) => t.tokenAddress === address)?.tokenSymbol ?? '?';
        return { chain, address, symbol: sym, qty: p.qty.toString(), costUsd: p.costUsd, source: source.get(p.tokenKey) ?? 'manual' };
      }),
    };
  }

  // ───── copy trading ─────

  @Public()
  @Get('copy/leaderboard')
  leaderboard(@Query('days') days = '30') {
    const d = parse(z.coerce.number().int().refine((n) => [7, 30, 90, 3650].includes(n)), days);
    return this.copy.leaderboard(d);
  }

  @Get('copy/subscriptions')
  mine(@CurrentUser() user: User) {
    return this.copy.mine(user);
  }

  @Post('copy/:handle')
  subscribe(@Param('handle') handle: string, @Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(
      z.object({
        mode: z.enum(['proportional', 'fixed']).optional(),
        budgetUsd: zMoney.optional(),
        fixedAmountUsd: zMoney.optional(),
        maxPerBuyUsd: zMoney.optional(),
        stopLossPct: z.number().int().min(1).max(100).optional(),
        copySells: z.boolean().optional(),
        memecoins: z.boolean().optional(),
        buyExisting: z.boolean().optional(),
        confirmAboveUsd: zMoney.optional(),
        chains: z.array(zChain).optional(),
      }),
      body,
    );
    return this.copy.subscribe(user, handle, b as any);
  }

  @Patch('copy/subscriptions/:id')
  status(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ status: z.enum(['active', 'paused', 'stopped']) }), body);
    return this.copy.setStatus(user, id, b.status);
  }

  @Post('copy/stop-all')
  stopAll(@CurrentUser() user: User) {
    return this.copy.stopAll(user);
  }

  @Get('copy/pending')
  pending(@CurrentUser() user: User) {
    return this.copy.pendingConfirmations(user);
  }

  @Post('copy/executions/:id/confirm')
  confirm(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ wallet: z.string().min(32).max(64) }), body);
    return this.copy.confirmBuild(user, id, b.wallet);
  }

  @Post('copy/executions/:id/skip')
  skip(@Param('id') id: string, @CurrentUser() user: User) {
    return this.copy.skipExecution(user, id);
  }
}

import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { dexscreener, tokenDecimals } from '@magura/chains';
import type { User } from '@magura/db';
import type { ChainId } from '@magura/shared';
import { CurrentUser, OptionalUser, Public } from '../auth/auth.guard';
import { PrismaService, RedisService } from '../common/infra.module';
import { parse, zChain } from '../common/zod';
import { computePnl, realizedByDay, streaks } from '../trading/pnl';
import { ReferralsService } from './referrals.service';

@Controller()
export class ReferralsController {
  constructor(
    private readonly refs: ReferralsService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Invite landing page: who invited you. */
  @Public()
  @Get('invite/:code')
  invite(@Param('code') code: string) {
    return this.refs.inviterFor(code);
  }

  @Post('me/referral')
  attach(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ code: z.string().min(2).max(20) }), body);
    return this.refs.attach(user, b.code);
  }

  @Get('me/rewards')
  rewards(@CurrentUser() user: User) {
    return this.refs.summary(user);
  }

  @Post('me/rewards/claim')
  claim(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ chain: zChain }), body);
    return this.refs.claim(user, b.chain);
  }

  /** PnL calendar: realized PnL for every day of a month, with green-day streaks. */
  @Public()
  @Get('cards/calendar/:handle/:month')
  async calendar(@Param('handle') handle: string, @Param('month') month: string, @OptionalUser() viewer?: User) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new NotFoundException();
    const u = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() }, include: { settings: true } });
    if (!u) throw new NotFoundException();
    if (u.settings && !u.settings.publicPnl && viewer?.id !== u.id) throw new ForbiddenException('private');
    const [y, m] = month.split('-').map(Number);
    const to = new Date(Date.UTC(y, m, 1));
    const all = await this.prisma.db.trade.findMany({ where: { userId: u.id, status: 'confirmed', createdAt: { lt: to } }, orderBy: { createdAt: 'asc' } });
    const byDay = realizedByDay(
      all.map((t) => ({ tokenKey: `${t.chain}:${t.tokenAddress}`, side: t.side as 'buy' | 'sell', amountIn: t.amountIn, amountOut: t.amountOut, amountUsd: Number(t.amountUsd ?? 0), at: t.createdAt })),
    );
    const days: Record<string, number> = {};
    for (const [d, v] of Object.entries(byDay)) if (d.startsWith(month)) days[d] = Math.round(v * 100) / 100;
    const all30 = streaks(byDay);
    const inMonth = streaks(days);
    const values = Object.values(days);
    return {
      handle: u.handle,
      avatarUrl: u.avatarUrl,
      month,
      days,
      totalUsd: Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100,
      greenDays: values.filter((v) => v > 0).length,
      redDays: values.filter((v) => v < 0).length,
      currentStreak: all30.current,
      bestStreak: inMonth.best,
    };
  }

  /** Month recap for a shareable card: trades, volume, realized PnL, win rate, best coin. */
  @Public()
  @Get('cards/recap/:handle/:month')
  async recap(@Param('handle') handle: string, @Param('month') month: string, @OptionalUser() viewer?: User) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new NotFoundException();
    const u = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() }, include: { settings: true } });
    if (!u) throw new NotFoundException();
    if (u.settings && !u.settings.publicPnl && viewer?.id !== u.id) throw new ForbiddenException('private');
    const [y, m] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const all = await this.prisma.db.trade.findMany({ where: { userId: u.id, status: 'confirmed', createdAt: { lt: to } }, orderBy: { createdAt: 'asc' } });
    const inMonth = all.filter((t) => t.createdAt >= from);
    const toPnl = (xs: typeof all) => computePnl(xs.map((t) => ({ tokenKey: `${t.chain}:${t.tokenAddress}`, side: t.side as 'buy' | 'sell', amountIn: t.amountIn, amountOut: t.amountOut, amountUsd: Number(t.amountUsd ?? 0) })));
    const end = toPnl(all);
    const begin = toPnl(all.filter((t) => t.createdAt < from));
    const realizedUsd = end.realizedUsd - begin.realizedUsd;
    const costUsd = end.costUsd - begin.costUsd;
    const closed = end.closed - begin.closed;
    const wins = end.wins - begin.wins;
    // best coin by realized PnL this month
    let best: { symbol: string; chain: string; pnlUsd: number; pct: number | null } | null = null;
    for (const key of new Set(inMonth.map((t) => `${t.chain}:${t.tokenAddress}`))) {
      const xs = all.filter((t) => `${t.chain}:${t.tokenAddress}` === key);
      const e = toPnl(xs);
      const b = toPnl(xs.filter((t) => t.createdAt < from));
      const pnl = e.realizedUsd - b.realizedUsd;
      const cost = e.costUsd - b.costUsd;
      if (pnl > 0 && (!best || pnl > best.pnlUsd)) best = { symbol: xs[xs.length - 1].tokenSymbol, chain: xs[0].chain, pnlUsd: pnl, pct: cost > 0 ? (pnl / cost) * 100 : null };
    }
    return {
      handle: u.handle,
      avatarUrl: u.avatarUrl,
      month,
      label: from.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      trades: inMonth.length,
      coins: new Set(inMonth.map((t) => `${t.chain}:${t.tokenAddress}`)).size,
      volumeUsd: inMonth.reduce((s, t) => s + Number(t.amountUsd ?? 0), 0),
      realizedUsd,
      roiPct: costUsd > 0 ? (realizedUsd / costUsd) * 100 : null,
      winRatePct: closed ? (wins / closed) * 100 : null,
      best,
    };
  }

  /** Data for a shareable PnL card on one coin. Public when the trader shows their PnL. */
  @Public()
  @Get('cards/pnl/:handle/:chain/:token')
  async pnlCard(@Param('handle') handle: string, @Param('chain') c: string, @Param('token') t: string, @OptionalUser() viewer?: User) {
    const chain = parse(zChain, c) as ChainId;
    const token = chain === 'solana' ? t : t.toLowerCase();
    const u = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() }, include: { settings: true } });
    if (!u) throw new NotFoundException();
    if (u.settings && !u.settings.publicPnl && viewer?.id !== u.id) throw new ForbiddenException('private');
    const trades = await this.prisma.db.trade.findMany({ where: { userId: u.id, chain, tokenAddress: token, status: 'confirmed' }, orderBy: { createdAt: 'asc' } });
    if (!trades.length) throw new NotFoundException('no_trades');
    const key = `${chain}:${token}`;
    const p = computePnl(trades.map((x) => ({ tokenKey: key, side: x.side as 'buy' | 'sell', amountIn: x.amountIn, amountOut: x.amountOut, amountUsd: Number(x.amountUsd ?? 0) })));
    const investedUsd = trades.filter((x) => x.side === 'buy').reduce((s, x) => s + Number(x.amountUsd ?? 0), 0);
    const returnedUsd = trades.filter((x) => x.side === 'sell').reduce((s, x) => s + Number(x.amountUsd ?? 0), 0);

    // still holding something → value it at today's price
    let openValueUsd = 0;
    const open = p.openPositions[0];
    if (open) {
      const [pair, dec] = await Promise.all([
        this.redis.cached(`pair:${chain}:${token}`, 15, () => dexscreener.bestPair(chain, token)).catch(() => null),
        this.redis.cached(`dec:${chain}:${token}`, 86_400, () => tokenDecimals(chain, token)).catch(() => null),
      ]);
      const price = pair?.priceUsd ?? (await this.prisma.db.token.findUnique({ where: { chain_address: { chain, address: token } } }))?.priceUsd ?? null;
      if (price != null && dec != null) openValueUsd = (Number(open.qty) / 10 ** dec) * price;
    }
    const pnlUsd = returnedUsd + openValueUsd - investedUsd;
    const first = trades[0].createdAt;
    const last = open ? new Date() : trades[trades.length - 1].createdAt;
    return {
      handle: u.handle,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      chain,
      token,
      symbol: trades[trades.length - 1].tokenSymbol,
      investedUsd,
      returnedUsd,
      openValueUsd,
      pnlUsd,
      pnlPct: investedUsd > 0 ? (pnlUsd / investedUsd) * 100 : null,
      holding: !!open,
      heldMs: last.getTime() - first.getTime(),
    };
  }
}

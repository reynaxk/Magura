import { Controller, Get, Injectable, NotFoundException, OnModuleInit, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import type { CallAttachment } from '@magura/shared';
import { Public } from '../auth/auth.guard';
import { PrismaService, RedisService } from '../common/infra.module';
import { parse } from '../common/zod';
import { computePnl } from '../trading/pnl';
import { TradingService } from '../trading/trading.service';
import { weekStart } from './week';

const WEEK = 7 * 86_400_000;
const MIN_GROUP_COST_USD = 50; // a group needs real money traded to rank
const MIN_MEMBER_COST_USD = 10;

type Row = { userId: string; handle: string; avatarUrl: string | null; realizedUsd: number; costUsd: number; roiPct: number | null; trades: number };

/** Fee discount for members of last week's winning group, for the whole current week. */
export const CHAMPION_DISCOUNT = 0.1;

@Injectable()
export class CompetitionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly trading: TradingService,
  ) {}

  onModuleInit() {
    this.trading.addDiscount(async (userId) => ((await this.champion())?.memberIds.includes(userId) ? CHAMPION_DISCOUNT : 0));
  }

  window(which: 'current' | 'last') {
    const start = weekStart();
    return which === 'current' ? { from: start, to: new Date(start.getTime() + WEEK) } : { from: new Date(start.getTime() - WEEK), to: start };
  }

  /** Realized PnL per user from their trades in a window (positions opened earlier count from their cost basis). */
  async memberRows(userIds: string[], from: Date, to: Date): Promise<Row[]> {
    if (!userIds.length) return [];
    const [users, trades] = await Promise.all([
      this.prisma.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, handle: true, avatarUrl: true, settings: { select: { publicPnl: true } } } }),
      this.prisma.db.trade.findMany({ where: { userId: { in: userIds }, status: 'confirmed', createdAt: { lt: to } }, orderBy: { createdAt: 'asc' } }),
    ]);
    return users
      .filter((u) => u.settings?.publicPnl !== false)
      .map((u) => {
        const mine = trades.filter((t) => t.userId === u.id);
        const toPnl = (xs: typeof mine) => computePnl(xs.map((t) => ({ tokenKey: `${t.chain}:${t.tokenAddress}`, side: t.side as 'buy' | 'sell', amountIn: t.amountIn, amountOut: t.amountOut, amountUsd: Number(t.amountUsd ?? 0) })));
        // PnL realized inside the window = all-time-to-`to` minus all-time-to-`from`
        const end = toPnl(mine);
        const begin = toPnl(mine.filter((t) => t.createdAt < from));
        const realizedUsd = end.realizedUsd - begin.realizedUsd;
        const costUsd = end.costUsd - begin.costUsd;
        return {
          userId: u.id,
          handle: u.handle,
          avatarUrl: u.avatarUrl,
          realizedUsd,
          costUsd,
          roiPct: costUsd > 0 ? (realizedUsd / costUsd) * 100 : null,
          trades: mine.filter((t) => t.createdAt >= from).length,
        };
      });
  }

  async ranking(week: 'current' | 'last') {
    return this.redis.cached(`comp:groups:${week}:${weekStart().toISOString()}`, week === 'last' ? 3600 : 300, async () => {
      const { from, to } = this.window(week);
      const groups = await this.prisma.db.group.findMany({
        where: { isPublic: true },
        select: { id: true, slug: true, name: true, iconUrl: true, color: true, members: { select: { userId: true } } },
        take: 500,
      });
      const ranked = [];
      for (const g of groups) {
        if (g.members.length < 2) continue;
        const rows = await this.memberRows(g.members.map((m) => m.userId), from, to);
        const cost = rows.reduce((s, r) => s + r.costUsd, 0);
        const realized = rows.reduce((s, r) => s + r.realizedUsd, 0);
        const active = rows.filter((r) => r.trades > 0).length;
        ranked.push({ slug: g.slug, name: g.name, iconUrl: g.iconUrl, color: g.color, members: g.members.length, active, realizedUsd: realized, roiPct: cost >= MIN_GROUP_COST_USD ? (realized / cost) * 100 : null });
      }
      ranked.sort((a, b) => (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity) || b.realizedUsd - a.realizedUsd);
      return { from, to, groups: ranked.slice(0, 50) };
    });
  }

  /** Last week's winner and its members (cached for the week). Null when nobody qualified. */
  async champion(): Promise<{ slug: string; name: string; roiPct: number; memberIds: string[] } | null> {
    return this.redis.cached(`comp:champion:${weekStart().toISOString()}`, 3600, async () => {
      const last = await this.ranking('last');
      const top = last.groups.find((g) => g.roiPct != null && g.roiPct > 0);
      if (!top) return null;
      const g = await this.prisma.db.group.findUnique({ where: { slug: top.slug }, select: { members: { select: { userId: true } } } });
      return { slug: top.slug, name: top.name, roiPct: top.roiPct!, memberIds: g?.members.map((m) => m.userId) ?? [] };
    });
  }
}

/** Weekly group-vs-group competition, in-group leaderboards and caller scoreboards. */
@Controller()
export class CompetitionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comp: CompetitionsService,
  ) {}

  @Public()
  @Get('competitions/groups')
  async groups(@Query() q: Record<string, string>) {
    const p = parse(z.object({ week: z.enum(['current', 'last']).default('current') }), q);
    const [board, champ] = await Promise.all([this.comp.ranking(p.week), this.comp.champion()]);
    return { ...board, champion: champ ? { slug: champ.slug, name: champ.name, roiPct: champ.roiPct, discountPct: CHAMPION_DISCOUNT * 100 } : null };
  }

  @Public()
  @Get('groups/:slug/leaderboard')
  async groupBoard(@Param('slug') slug: string, @Query() q: Record<string, string>) {
    const p = parse(z.object({ week: z.enum(['current', 'last']).default('current') }), q);
    const g = await this.prisma.db.group.findUnique({ where: { slug }, select: { id: true, isPublic: true, members: { select: { userId: true } } } });
    if (!g) throw new NotFoundException();
    const { from, to } = this.comp.window(p.week);
    const rows = await this.comp.memberRows(g.members.map((m) => m.userId), from, to);
    return {
      from,
      to,
      members: rows
        .filter((r) => r.trades > 0 || r.realizedUsd !== 0)
        .sort((a, b) => b.realizedUsd - a.realizedUsd)
        .map(({ userId: _id, ...r }) => ({ ...r, roiPct: r.costUsd >= MIN_MEMBER_COST_USD ? r.roiPct : null })),
    };
  }

  /** How each member's calls in this group have done since they were posted. */
  @Public()
  @Get('groups/:slug/callers')
  async callers(@Param('slug') slug: string, @Query() q: Record<string, string>) {
    const p = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }), q);
    const g = await this.prisma.db.group.findUnique({ where: { slug }, select: { id: true } });
    if (!g) throw new NotFoundException();
    const msgs = await this.prisma.db.message.findMany({
      where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - p.days * 86_400_000) }, attachment: { path: ['kind'], equals: 'call' }, room: { channel: { groupId: g.id } } },
      include: { author: { select: { id: true, handle: true, avatarUrl: true } } },
      take: 1000,
    });
    const calls = msgs.map((m) => ({ m, a: m.attachment as unknown as CallAttachment }));
    const tokens = await this.prisma.db.token.findMany({
      where: { OR: calls.map(({ a }) => ({ chain: a.chain, address: a.chain === 'solana' ? a.token.address : a.token.address.toLowerCase() })) },
      select: { chain: true, address: true, priceUsd: true },
    });
    const price = new Map(tokens.map((t) => [`${t.chain}:${t.address}`, t.priceUsd]));
    const by = new Map<string, { handle: string; avatarUrl: string | null; calls: number; scored: number; sumPct: number; wins: number; best: { symbol: string; pct: number } | null }>();
    for (const { m, a } of calls) {
      const row = by.get(m.author.id) ?? { handle: m.author.handle, avatarUrl: m.author.avatarUrl, calls: 0, scored: 0, sumPct: 0, wins: 0, best: null };
      row.calls++;
      const now = price.get(`${a.chain}:${a.chain === 'solana' ? a.token.address : a.token.address.toLowerCase()}`);
      if (a.priceAtCall && now) {
        const pct = (now / a.priceAtCall - 1) * 100;
        row.scored++;
        row.sumPct += pct;
        if (pct > 0) row.wins++;
        if (!row.best || pct > row.best.pct) row.best = { symbol: a.token.symbol, pct };
      }
      by.set(m.author.id, row);
    }
    return [...by.values()]
      .map((r) => ({ handle: r.handle, avatarUrl: r.avatarUrl, calls: r.calls, avgPct: r.scored ? r.sumPct / r.scored : null, hitRatePct: r.scored ? (r.wins / r.scored) * 100 : null, best: r.best }))
      .sort((a, b) => (b.avgPct ?? -Infinity) - (a.avgPct ?? -Infinity));
  }
}

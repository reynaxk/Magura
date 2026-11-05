import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@magura/db';
import type { CallAttachment, ChainId } from '@magura/shared';
import { CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/infra.module';
import { parse } from '../common/zod';

type Who = { handle: string; avatarUrl: string | null };
type Coin = { chain: ChainId; address: string; symbol: string; imageUrl: string | null; priceUsd: number | null; marketCapUsd: number | null; change24h: number | null };

export type FeedItem =
  | { kind: 'trade'; id: string; at: string; user: Who; side: 'buy' | 'sell'; amountUsd: number | null; source: string; coin: Coin }
  | { kind: 'call'; id: string; at: string; user: Who; group: { slug: string; name: string }; buyZone: string; target: string; invalidation: string; sinceCallPct: number | null; coin: Coin };

/** The Following feed: trades by people you follow and calls from your groups, newest first. */
@Controller('feed')
export class FeedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async feed(@Query() q: Record<string, string>, @CurrentUser() user: User): Promise<{ items: FeedItem[]; next: string | null }> {
    const p = parse(z.object({ before: z.string().datetime().optional(), only: z.enum(['all', 'trades', 'calls']).default('all') }), q);
    const before = p.before ? new Date(p.before) : new Date();
    const since = new Date(before.getTime() - 14 * 86_400_000);
    const LIMIT = 40;

    const [follows, groups] = await Promise.all([
      this.prisma.db.follow.findMany({ where: { followerId: user.id }, select: { followingId: true } }),
      this.prisma.db.groupMember.findMany({ where: { userId: user.id }, select: { groupId: true } }),
    ]);
    const followIds = follows.map((f) => f.followingId);

    const [trades, calls] = await Promise.all([
      p.only !== 'calls' && followIds.length
        ? this.prisma.db.trade.findMany({
            where: { userId: { in: followIds }, status: 'confirmed', createdAt: { lt: before, gte: since } },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            include: { user: { select: { handle: true, avatarUrl: true, settings: { select: { publicPnl: true } } } } },
          })
        : Promise.resolve([]),
      p.only !== 'trades' && groups.length
        ? this.prisma.db.message.findMany({
            where: {
              deletedAt: null,
              createdAt: { lt: before, gte: since },
              attachment: { path: ['kind'], equals: 'call' },
              room: { channel: { groupId: { in: groups.map((g) => g.groupId) } } },
            },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            include: {
              author: { select: { handle: true, avatarUrl: true } },
              room: { select: { channel: { select: { group: { select: { slug: true, name: true } } } } } },
            },
          })
        : Promise.resolve([]),
    ]);

    // coin snapshots for everything on the page
    const keys = new Map<string, { chain: ChainId; address: string; symbol: string }>();
    for (const t of trades) keys.set(`${t.chain}:${t.tokenAddress}`, { chain: t.chain as ChainId, address: t.tokenAddress, symbol: t.tokenSymbol });
    for (const m of calls) {
      const a = m.attachment as unknown as CallAttachment;
      const addr = a.chain === 'solana' ? a.token.address : a.token.address.toLowerCase();
      keys.set(`${a.chain}:${addr}`, { chain: a.chain, address: addr, symbol: a.token.symbol });
    }
    const tokens = keys.size
      ? await this.prisma.db.token.findMany({ where: { OR: [...keys.values()].map((k) => ({ chain: k.chain, address: k.address })) } })
      : [];
    const tok = new Map(tokens.map((t) => [`${t.chain}:${t.address}`, t]));
    const coin = (k: { chain: ChainId; address: string; symbol: string }): Coin => {
      const t = tok.get(`${k.chain}:${k.address}`);
      return { ...k, imageUrl: t?.imageUrl ?? null, priceUsd: t?.priceUsd ?? null, marketCapUsd: t?.marketCapUsd ?? null, change24h: t?.priceChange24h ?? null };
    };

    const items: FeedItem[] = [
      ...trades
        .filter((t) => t.user.settings?.publicPnl !== false)
        .map(
          (t): FeedItem => ({
            kind: 'trade',
            id: t.id,
            at: t.createdAt.toISOString(),
            user: { handle: t.user.handle, avatarUrl: t.user.avatarUrl },
            side: t.side as 'buy' | 'sell',
            amountUsd: t.amountUsd != null ? Number(t.amountUsd) : null,
            source: t.source,
            coin: coin({ chain: t.chain as ChainId, address: t.tokenAddress, symbol: t.tokenSymbol }),
          }),
        ),
      ...calls.map((m): FeedItem => {
        const a = m.attachment as unknown as CallAttachment;
        const c = coin({ chain: a.chain, address: a.chain === 'solana' ? a.token.address : a.token.address.toLowerCase(), symbol: a.token.symbol });
        return {
          kind: 'call',
          id: m.id,
          at: m.createdAt.toISOString(),
          user: { handle: m.author.handle, avatarUrl: m.author.avatarUrl },
          group: m.room.channel!.group,
          buyZone: a.buyZone,
          target: a.target,
          invalidation: a.invalidation,
          sinceCallPct: a.priceAtCall && c.priceUsd ? (c.priceUsd / a.priceAtCall - 1) * 100 : null,
          coin: c,
        };
      }),
    ]
      .sort((x, y) => y.at.localeCompare(x.at))
      .slice(0, LIMIT);

    return { items, next: items.length === LIMIT ? items[items.length - 1].at : null };
  }
}

import { Injectable } from '@nestjs/common';
import type { Token } from '@magura/db';
import { matchesFilter, roomIds, type ChainId, type ChatMessageDTO, type CoinFilter, type HuntToken, type TokenIntel, type TokenRisk, type TrenchStage } from '@magura/shared';
import { factsFor } from './filter-facts';
import { ChatService } from '../chat/chat.service';
import { PrismaService, RedisService } from '../common/infra.module';

export type HuntSort = 'hot' | 'gainers' | 'losers' | 'volume' | 'new' | 'm5';

export interface HuntQuery {
  sort: HuntSort;
  filter: CoinFilter;
  limit: number;
}

/**
 * Hunt = finding coins. Ranks tokens Magura is tracking by market activity and
 * by what only Magura sees: how busy each coin's chat room is and who in your
 * network is buying.
 */
@Injectable()
export class HuntService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly chat: ChatService,
  ) {}

  async list(q: HuntQuery, viewerId: string | null): Promise<{ items: HuntToken[]; total: number }> {
    const f = q.filter;
    const pool = await this.prisma.db.token.findMany({
      where: { chain: { in: f.chains }, ...(q.sort === 'new' ? {} : { priceUsd: { not: null } }) },
      orderBy: q.sort === 'new' ? { createdAt: 'desc' } : { volumeUsd: { sort: 'desc', nulls: 'last' } },
      take: 600,
    });
    const roomKeys = pool.map((t) => roomIds.coin(t.chain, t.address));
    const [counts, recent, friends] = await Promise.all([
      this.chat.coinRoomCounts(roomKeys),
      this.recentChat(roomKeys),
      viewerId ? this.friendsBought(viewerId, pool) : Promise.resolve([]),
    ]);
    const friendSet = new Set(friends.map((x) => x.tokenAddress));
    const tokens = pool.filter((t) => (t.marketCapUsd ?? 0) < 3e12 && matchesFilter(factsFor(t, counts[roomIds.coin(t.chain, t.address)] ?? 0, friendSet.has(t.address)), f));

    const scored = tokens.map((t) => {
      const key = roomIds.coin(t.chain, t.address);
      const vol = t.volumeUsd ?? 0;
      const chg = t.priceChange1h ?? t.priceChange24h ?? 0;
      // volume (log-scaled) + momentum + chat buzz in the last hour
      const hotScore = Math.log10(1 + vol) * 10 + Math.max(-20, Math.min(40, chg)) * 0.5 + (recent[key] ?? 0) * 3;
      return { t, chatCount: counts[key] ?? 0, hotScore };
    });

    const by: Record<HuntSort, (a: (typeof scored)[number], b: (typeof scored)[number]) => number> = {
      hot: (a, b) => b.hotScore - a.hotScore,
      gainers: (a, b) => (b.t.priceChange24h ?? -1e9) - (a.t.priceChange24h ?? -1e9),
      losers: (a, b) => (a.t.priceChange24h ?? 1e9) - (b.t.priceChange24h ?? 1e9),
      volume: (a, b) => (b.t.volumeUsd ?? 0) - (a.t.volumeUsd ?? 0),
      new: (a, b) => +b.t.createdAt - +a.t.createdAt,
      m5: (a, b) => (b.t.volume5m ?? 0) - (a.t.volume5m ?? 0),
    };
    const ranked = scored.sort(by[q.sort]).slice(0, q.limit);
    return { items: ranked.map(({ t, chatCount, hotScore }) => this.toRow(t, chatCount, hotScore, friends)), total: scored.length };
  }

  /** Tokens people you follow (or copy) bought in the last 24h. */
  async friendsBuying(viewerId: string) {
    const trades = await this.prisma.db.trade.findMany({
      where: {
        side: 'buy',
        status: 'confirmed',
        createdAt: { gte: new Date(Date.now() - 86400_000) },
        user: { followers: { some: { followerId: viewerId } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { chain: true, tokenAddress: true, tokenSymbol: true, amountUsd: true, createdAt: true, user: { select: { id: true, handle: true, avatarUrl: true } } },
    });
    const byToken = new Map<string, { chain: string; address: string; symbol: string; buyers: { handle: string; avatarUrl: string | null }[]; totalUsd: number; lastAt: Date }>();
    for (const t of trades) {
      const k = `${t.chain}:${t.tokenAddress}`;
      const row = byToken.get(k) ?? { chain: t.chain, address: t.tokenAddress, symbol: t.tokenSymbol, buyers: [], totalUsd: 0, lastAt: t.createdAt };
      if (!row.buyers.some((b) => b.handle === t.user.handle)) row.buyers.push({ handle: t.user.handle, avatarUrl: t.user.avatarUrl });
      row.totalUsd += Number(t.amountUsd ?? 0);
      byToken.set(k, row);
    }
    return [...byToken.values()].sort((a, b) => b.buyers.length - a.buyers.length || +b.lastAt - +a.lastAt).slice(0, 8);
  }

  /** Latest spot calls posted in public group channels. */
  async freshCalls(limit = 8): Promise<(ChatMessageDTO & { group: { slug: string; name: string } })[]> {
    const msgs = await this.prisma.db.message.findMany({
      where: { deletedAt: null, attachment: { path: ['kind'], equals: 'call' }, room: { channel: { group: { isPublic: true } } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        author: { select: { id: true, handle: true, avatarUrl: true, badges: true } },
        room: { select: { channel: { select: { group: { select: { slug: true, name: true } } } } } },
      },
    });
    return msgs.map((m) => ({ ...this.chat.toDTO(m), group: m.room.channel!.group }));
  }

  /** Messages per coin room in the last hour (chat buzz). */
  private async recentChat(roomKeys: string[]): Promise<Record<string, number>> {
    if (!roomKeys.length) return {};
    const rows = await this.prisma.db.message.groupBy({
      by: ['roomId'],
      where: { roomId: { in: roomKeys }, createdAt: { gte: new Date(Date.now() - 3600_000) } },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.roomId, r._count._all]));
  }

  private async friendsBought(viewerId: string, tokens: Token[]) {
    if (!tokens.length) return [];
    return this.prisma.db.trade.findMany({
      where: { side: 'buy', status: 'confirmed', tokenAddress: { in: tokens.map((t) => t.address) }, user: { followers: { some: { followerId: viewerId } } } },
      distinct: ['userId', 'tokenAddress'],
      select: { tokenAddress: true, user: { select: { id: true, handle: true, avatarUrl: true } } },
      take: 300,
    });
  }

  private toRow(
    t: Token,
    chatCount: number,
    hotScore: number,
    friends: { tokenAddress: string; user: { id: string; handle: string; avatarUrl: string | null } }[],
  ): HuntToken {
    return {
      chain: t.chain as ChainId,
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      imageUrl: t.imageUrl,
      stage: t.stage as TrenchStage,
      createdAt: t.createdAt.toISOString(),
      priceUsd: t.priceUsd,
      change1h: t.priceChange1h,
      change24h: t.priceChange24h,
      marketCapUsd: t.marketCapUsd,
      volumeUsd: t.volumeUsd,
      liquidityUsd: t.liquidityUsd,
      risk: (t.risk as TokenRisk | null) ?? null,
      intel: (t.intel as TokenIntel | null) ?? null,
      holders: t.holders,
      athMarketCapUsd: t.athMarketCapUsd,
      volume5m: t.volume5m,
      buys5m: t.buys5m,
      sells5m: t.sells5m,
      hasX: t.hasX,
      hasTelegram: t.hasTelegram,
      hasWebsite: t.hasWebsite,
      launchpad: t.launchpad,
      devSold: !!t.devSoldAt,
      dexPaid: t.dexPaid,
      chatCount,
      friendsBought: friends.filter((f) => f.tokenAddress === t.address).map((f) => ({ userId: f.user.id, handle: f.user.handle, avatarUrl: f.user.avatarUrl })),
      hotScore: Math.round(hotScore * 10) / 10,
    };
  }
}

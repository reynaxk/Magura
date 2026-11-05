import { Injectable } from '@nestjs/common';
import type { Prisma, Token } from '@magura/db';
import { roomIds, type ChainId, type ChatMessageDTO, type HuntToken, type TokenRisk, type TrenchStage } from '@magura/shared';
import { ChatService } from '../chat/chat.service';
import { PrismaService, RedisService } from '../common/infra.module';

export type HuntSort = 'hot' | 'gainers' | 'losers' | 'volume' | 'new';

export interface HuntFilters {
  chains: ChainId[];
  sort: HuntSort;
  minMc?: number;
  maxMc?: number;
  maxAgeH?: number;
  minLiq?: number;
  safeOnly?: boolean;
  limit: number;
}

/** A token is "safe enough" when holders aren't concentrated and it isn't a known trap. */
function passesSafety(risk: TokenRisk | null): boolean {
  if (!risk) return false;
  if (risk.honeypot || risk.mintable || risk.freezable) return false;
  if (risk.top10Pct != null && risk.top10Pct > 35) return false;
  if (risk.devPct != null && risk.devPct > 5) return false;
  if (risk.sellTax != null && risk.sellTax > 5) return false;
  return true;
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

  async list(f: HuntFilters, viewerId: string | null): Promise<HuntToken[]> {
    const where: Prisma.TokenWhereInput = {
      chain: { in: f.chains },
      ...(f.minMc != null || f.maxMc != null ? { marketCapUsd: { gte: f.minMc ?? undefined, lte: f.maxMc ?? undefined } } : {}),
      ...(f.minLiq != null ? { liquidityUsd: { gte: f.minLiq } } : {}),
      ...(f.maxAgeH != null ? { createdAt: { gte: new Date(Date.now() - f.maxAgeH * 3600_000) } } : {}),
    };
    // pull a wider pool, then rank in memory (needs chat activity from Redis)
    const pool = await this.prisma.db.token.findMany({
      where,
      orderBy: f.sort === 'new' ? { createdAt: 'desc' } : { volumeUsd: { sort: 'desc', nulls: 'last' } },
      take: 400,
    });
    const tokens = f.safeOnly ? pool.filter((t) => passesSafety(t.risk as TokenRisk | null)) : pool;
    const roomKeys = tokens.map((t) => roomIds.coin(t.chain, t.address));
    const [counts, recent] = await Promise.all([this.chat.coinRoomCounts(roomKeys), this.recentChat(roomKeys)]);

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
    };
    const ranked = scored.sort(by[f.sort]).slice(0, f.limit);
    const friends = viewerId ? await this.friendsBought(viewerId, ranked.map((r) => r.t)) : [];
    return ranked.map(({ t, chatCount, hotScore }) => this.toRow(t, chatCount, hotScore, friends));
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
      chatCount,
      friendsBought: friends.filter((f) => f.tokenAddress === t.address).map((f) => ({ userId: f.user.id, handle: f.user.handle, avatarUrl: f.user.avatarUrl })),
      hotScore: Math.round(hotScore * 10) / 10,
    };
  }
}

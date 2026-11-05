import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ClankerFeed,
  PumpFunFeed,
  coinbase,
  dexscreener,
  evmFactoryFeedsFromEnv,
  geckoterminal,
  goplus,
  type LaunchEvent,
  type LaunchpadFeed,
} from '@magura/chains';
import type { Chain, Token } from '@magura/db';
import { CHAIN_IDS, roomIds, type ChainId, type TokenRisk, type TrenchStage, type TrenchToken } from '@magura/shared';
import { env } from '../config';
import { ChatService } from '../chat/chat.service';
import { PrismaService, RedisService } from '../common/infra.module';
import { RealtimeService } from '../realtime/realtime.service';

/** Stage thresholds. Launchpad tokens use the bonding curve; DEX-native tokens use age + market cap. */
const ALMOST_BONDING_PCT = 70;
const DEX_ALMOST_MC = 30_000;
const DEX_SURVIVED_MC = 100_000;
const DEX_SURVIVED_LIQ = 20_000;

export function stageFor(t: Pick<Token, 'launchpad' | 'bondingPct' | 'migratedAt' | 'marketCapUsd' | 'liquidityUsd' | 'createdAt'>): TrenchStage {
  if (t.migratedAt) return 'survived';
  const usesCurve = t.launchpad === 'pumpfun' || t.launchpad === 'fourmeme' || t.launchpad === 'flap' || t.launchpad === 'pons';
  if (usesCurve) return (t.bondingPct ?? 0) >= ALMOST_BONDING_PCT ? 'almost' : 'new';
  const mc = t.marketCapUsd ?? 0;
  if (mc >= DEX_SURVIVED_MC && (t.liquidityUsd ?? 0) >= DEX_SURVIVED_LIQ) return 'survived';
  if (mc >= DEX_ALMOST_MC) return 'almost';
  return 'new';
}

@Injectable()
export class TrenchesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('trenches');
  private feeds: LaunchpadFeed[] = [];
  private timers: NodeJS.Timeout[] = [];
  private solUsd = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rt: RealtimeService,
    private readonly chat: ChatService,
  ) {}

  async onModuleInit() {
    if (env.TRENCHES_WORKER !== '1' || env.NODE_ENV === 'test') return;
    await this.refreshMajors();
    this.feeds = [new PumpFunFeed(() => this.solUsd), new ClankerFeed(), ...evmFactoryFeedsFromEnv()];
    for (const f of this.feeds) {
      try {
        await f.start((e) => void this.onLaunchEvent(e).catch((err) => this.log.warn(err.message)));
        this.log.log(`feed started: ${f.id} (${f.chain})`);
      } catch (e) {
        this.log.warn(`feed ${f.id} failed to start: ${(e as Error).message}`);
      }
    }
    this.every(30_000, () => this.refreshMajors());
    this.every(30_000, () => this.pollNewPools());
    this.every(12_000, () => this.enrichMarket());
    this.every(20_000, () => this.enrichRisk());
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
    this.feeds.forEach((f) => f.stop());
  }

  private every(ms: number, fn: () => Promise<unknown>) {
    this.timers.push(setInterval(() => fn().catch((e) => this.log.debug((e as Error).message)), ms));
  }

  private async refreshMajors() {
    const px = await coinbase.many(['SOL', 'ETH', 'BNB', 'BTC']);
    if (px.SOL) this.solUsd = px.SOL;
    await this.redis.client.set('majors', JSON.stringify(px), 'EX', 120);
  }

  /** Launchpad events → upsert + broadcast. */
  async onLaunchEvent(e: LaunchEvent) {
    const where = { chain_address: { chain: e.chain as Chain, address: e.address } };
    const existing = await this.prisma.db.token.findUnique({ where });
    if (!existing && e.type !== 'created') return; // only track tokens we saw launch
    const data = {
      symbol: e.symbol ?? existing?.symbol ?? '?',
      name: e.name ?? existing?.name ?? '?',
      imageUrl: e.imageUrl ?? existing?.imageUrl ?? null,
      launchpad: e.launchpad,
      creator: e.creator ?? existing?.creator ?? null,
      marketCapUsd: e.marketCapUsd ?? existing?.marketCapUsd ?? null,
      bondingPct: e.bondingPct ?? existing?.bondingPct ?? null,
      pairAddress: e.pairAddress ?? existing?.pairAddress ?? null,
      migratedAt: e.type === 'migrated' ? e.at : (existing?.migratedAt ?? null),
    };
    const stage = stageFor({ ...data, liquidityUsd: existing?.liquidityUsd ?? null, createdAt: existing?.createdAt ?? e.at });
    // throttle progress writes: at most once per 3s per token
    if (e.type === 'progress' && !(await this.redis.allow(`tp:${e.chain}:${e.address}`, 1, 3)) && stage === existing?.stage) return;
    const token = await this.prisma.db.token.upsert({
      where,
      update: { ...data, stage },
      create: { chain: e.chain as Chain, address: e.address, ...data, stage, createdAt: e.at },
    });
    const room = `trenches:${e.chain}`;
    if (e.type === 'created') this.rt.toRoom(room, 'trenches:token', await this.toTrench(token, {}, []));
    else
      this.rt.toRoom(room, 'trenches:update', {
        chain: token.chain,
        address: token.address,
        stage: token.stage as TrenchStage,
        marketCapUsd: token.marketCapUsd,
        bondingPct: token.bondingPct,
      });
  }

  /** DEX new pools (all chains). Ethereum relies on this entirely. */
  private async pollNewPools() {
    for (const chain of CHAIN_IDS) {
      const pools = await geckoterminal.newPools(chain).catch(() => []);
      for (const p of pools) {
        if (!p.baseTokenAddress) continue;
        const address = chain === 'solana' ? p.baseTokenAddress : p.baseTokenAddress.toLowerCase();
        const exists = await this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } }, select: { address: true } });
        if (exists) continue;
        const [symbol, name] = [p.name.split(' / ')[0], p.name.split(' / ')[0]];
        const token = await this.prisma.db.token.create({
          data: {
            chain,
            address,
            symbol,
            name,
            pairAddress: p.poolAddress,
            marketCapUsd: p.marketCapUsd ?? p.fdvUsd,
            volumeUsd: p.volume24h,
            liquidityUsd: p.liquidityUsd,
            priceUsd: p.priceUsd,
            buys: p.buys24h,
            sells: p.sells24h,
            createdAt: new Date(p.createdAt),
            stage: 'new',
          },
        });
        const stage = stageFor(token);
        if (stage !== 'new') await this.prisma.db.token.update({ where: { chain_address: { chain, address } }, data: { stage } });
        this.rt.toRoom(`trenches:${chain}`, 'trenches:token', await this.toTrench({ ...token, stage }, {}, []));
      }
    }
  }

  /** Refresh MC/volume/tx counts for live tokens via DexScreener (batched 30 per call). */
  private async enrichMarket() {
    const since = new Date(Date.now() - 6 * 3600_000);
    for (const chain of CHAIN_IDS) {
      const tokens = await this.prisma.db.token.findMany({
        where: { chain, createdAt: { gte: since } },
        orderBy: { updatedAt: 'asc' },
        take: 30,
      });
      if (!tokens.length) continue;
      const pairs = await dexscreener.tokenPairs(chain, tokens.map((t) => t.address)).catch(() => []);
      for (const t of tokens) {
        const p = pairs.find((x) => x.baseToken.address.toLowerCase() === t.address.toLowerCase());
        const next = {
          marketCapUsd: p?.marketCap ?? p?.fdv ?? t.marketCapUsd,
          volumeUsd: p?.volume24h ?? t.volumeUsd,
          liquidityUsd: p?.liquidityUsd ?? t.liquidityUsd,
          priceUsd: p?.priceUsd ?? t.priceUsd,
          priceChange1h: p?.priceChange1h ?? t.priceChange1h,
          priceChange24h: p?.priceChange24h ?? t.priceChange24h,
          pairAddress: t.pairAddress ?? p?.pairAddress ?? null,
          imageUrl: t.imageUrl ?? p?.imageUrl ?? null,
          // pump.fun tokens that appear on a non-pump DEX have migrated
          migratedAt: t.migratedAt ?? (t.launchpad === 'pumpfun' && p && p.dex !== 'pumpfun' ? new Date() : null),
        };
        const stage = stageFor({ ...t, ...next });
        await this.prisma.db.token.update({ where: { chain_address: { chain, address: t.address } }, data: { ...next, stage } });
        if (stage !== t.stage || next.marketCapUsd !== t.marketCapUsd) {
          this.rt.toRoom(`trenches:${chain}`, 'trenches:update', {
            chain,
            address: t.address,
            stage,
            marketCapUsd: next.marketCapUsd,
            volumeUsd: next.volumeUsd,
          });
        }
      }
    }
  }

  /** GoPlus risk for tokens that don't have it yet (rate-limited). */
  private async enrichRisk() {
    const tokens = await this.prisma.db.token.findMany({
      where: { riskCheckedAt: null, createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    for (const t of tokens) {
      const risk = await goplus.tokenRisk(t.chain as ChainId, t.address).catch(() => null);
      await this.prisma.db.token.update({
        where: { chain_address: { chain: t.chain, address: t.address } },
        data: { risk: (risk ?? undefined) as object | undefined, riskCheckedAt: new Date() },
      });
    }
  }

  async list(chains: ChainId[], stage: TrenchStage, limit: number, viewerId: string | null): Promise<TrenchToken[]> {
    const orderBy =
      stage === 'almost'
        ? [{ bondingPct: 'desc' as const }, { marketCapUsd: 'desc' as const }]
        : stage === 'survived'
          ? [{ migratedAt: 'desc' as const }, { createdAt: 'desc' as const }]
          : [{ createdAt: 'desc' as const }];
    const tokens = await this.prisma.db.token.findMany({
      where: { chain: { in: chains }, stage },
      orderBy,
      take: Math.min(limit, 100),
    });
    const counts = await this.chat.coinRoomCounts(tokens.map((t) => roomIds.coin(t.chain, t.address)));
    const friends = viewerId ? await this.friendsBought(viewerId, tokens) : [];
    return Promise.all(tokens.map((t) => this.toTrench(t, counts, friends)));
  }

  /** "kairo +2 aped" — people you follow who bought this token. */
  private async friendsBought(viewerId: string, tokens: Token[]) {
    if (!tokens.length) return [];
    return this.prisma.db.trade.findMany({
      where: {
        side: 'buy',
        status: 'confirmed',
        tokenAddress: { in: tokens.map((t) => t.address) },
        user: { followers: { some: { followerId: viewerId } } },
      },
      distinct: ['userId', 'tokenAddress'],
      select: { tokenAddress: true, user: { select: { id: true, handle: true, avatarUrl: true } } },
      take: 300,
    });
  }

  private async toTrench(
    t: Token,
    counts: Record<string, number>,
    friends: { tokenAddress: string; user: { id: string; handle: string; avatarUrl: string | null } }[],
  ): Promise<TrenchToken> {
    return {
      chain: t.chain as ChainId,
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      imageUrl: t.imageUrl,
      launchpad: (t.launchpad as TrenchToken['launchpad']) ?? null,
      stage: t.stage as TrenchStage,
      createdAt: t.createdAt.toISOString(),
      marketCapUsd: t.marketCapUsd,
      volumeUsd: t.volumeUsd,
      holders: t.holders,
      bondingPct: t.migratedAt ? 100 : t.bondingPct,
      buys: t.buys,
      sells: t.sells,
      risk: (t.risk as TokenRisk | null) ?? null,
      chatCount: counts[roomIds.coin(t.chain, t.address)] ?? 0,
      friendsBought: friends
        .filter((f) => f.tokenAddress === t.address)
        .map((f) => ({ userId: f.user.id, handle: f.user.handle, avatarUrl: f.user.avatarUrl })),
    };
  }
}

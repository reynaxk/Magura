import { Injectable } from '@nestjs/common';
import { dexscreener, geckoterminal, goplus, type PoolTrade } from '@magura/chains';
import { CHAINS, type ChainId } from '@magura/shared';
import { PrismaService, RedisService } from '../common/infra.module';

export type WalletTag = 'you' | 'magura' | 'following' | 'tracked' | 'dev' | 'early' | 'pool' | 'locked';

export interface CoinTrade {
  side: 'buy' | 'sell';
  wallet: string;
  usd: number | null;
  mcUsd: number | null;
  at: string;
  txHash: string;
  tags: WalletTag[];
  name: string | null;
}

export interface CoinHolder {
  address: string;
  pct: number;
  tags: WalletTag[];
  name: string | null;
}

export interface FriendTrade {
  handle: string;
  avatarUrl: string | null;
  side: 'buy' | 'sell';
  at: string;
  usd: number | null;
}

/** Who is trading a coin: live swaps and top holders, labelled with what Magura knows about each wallet. */
@Injectable()
export class CoinActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async market(chain: ChainId, address: string) {
    const [pair, row] = await Promise.all([
      this.redis.cached(`pair:${chain}:${address}`, 15, () => dexscreener.bestPair(chain, address)).catch(() => null),
      this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } } }),
    ]);
    const price = pair?.priceUsd ?? row?.priceUsd ?? null;
    const mc = pair?.marketCap ?? pair?.fdv ?? row?.marketCapUsd ?? null;
    return { pool: pair?.pairAddress ?? row?.pairAddress ?? null, supply: price && mc ? mc / price : null };
  }

  private creator(chain: ChainId, address: string) {
    return this.redis.cached(`holders:${chain}:${address}`, 300, () => goplus.topHolders(chain, address)).catch(() => ({ creator: null, holders: [] }));
  }

  /** Labels for a set of addresses, from the viewer's point of view. */
  private async labeller(chain: ChainId, addresses: string[], viewerId: string | null, creator: string | null) {
    const kind = CHAINS[chain].kind;
    const norm = (a: string) => (kind === 'evm' ? a.toLowerCase() : a);
    const set = [...new Set(addresses.map(norm))];
    const [wallets, following, tracked] = await Promise.all([
      set.length
        ? this.prisma.db.wallet.findMany({
            where:
              kind === 'evm'
                ? { chainKind: kind, OR: set.map((a) => ({ address: { equals: a, mode: 'insensitive' as const } })) }
                : { chainKind: kind, address: { in: set } },
            include: { user: { select: { id: true, handle: true } } },
          })
        : Promise.resolve([]),
      viewerId ? this.prisma.db.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }) : [],
      viewerId ? this.prisma.db.trackedWallet.findMany({ where: { userId: viewerId, chainKind: kind } }) : [],
    ]);
    const follows = new Set(following.map((f) => f.followingId));
    const byAddr = new Map(wallets.map((w) => [norm(w.address), w]));
    const trackedBy = new Map(tracked.map((t) => [norm(t.address), t.label]));
    const dev = creator ? norm(creator) : null;
    return (address: string, extra: WalletTag[] = []) => {
      const a = norm(address);
      const tags: WalletTag[] = [...extra];
      let name: string | null = null;
      const w = byAddr.get(a);
      if (w) {
        name = w.user.handle;
        if (w.user.id === viewerId) tags.unshift('you');
        else if (follows.has(w.user.id)) tags.unshift('following');
        else tags.unshift('magura');
      }
      const t = trackedBy.get(a);
      if (t) {
        tags.push('tracked');
        name ??= t;
      }
      if (dev && a === dev) tags.push('dev');
      return { tags, name };
    };
  }

  async trades(chain: ChainId, address: string, viewerId: string | null, minUsd = 0): Promise<CoinTrade[]> {
    const { pool, supply } = await this.market(chain, address);
    const [raw, holders] = await Promise.all([
      pool
        ? this.redis.cachedStale(`trades:${chain}:${pool}:${minUsd}`, 15, 3600, () => geckoterminal.trades(chain, pool, minUsd)).catch(() => [] as PoolTrade[])
        : Promise.resolve([] as PoolTrade[]),
      this.creator(chain, address),
    ]);
    // Coins still on a bonding curve have no DEX pool yet — fall back to trades made through Magura.
    let rows: PoolTrade[] = raw;
    const owners = new Map<string, { userId: string; handle: string }>();
    if (!pool) {
      const own = await this.prisma.db.trade.findMany({
        where: { chain, tokenAddress: address, status: { in: ['confirmed', 'pending'] } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { id: true, handle: true, wallets: { select: { address: true, chainKind: true } } } } },
      });
      for (const t of own) owners.set(t.txHash ?? t.id, { userId: t.user.id, handle: t.user.handle });
      rows = own.map((t) => ({
        side: t.side as 'buy' | 'sell',
        wallet: t.user.wallets.find((w) => w.chainKind === CHAINS[chain].kind)?.address ?? '',
        usd: t.amountUsd != null ? Number(t.amountUsd) : null,
        priceUsd: t.priceUsd,
        tokenAmount: null,
        quoteAmount: null,
        block: null,
        txHash: t.txHash ?? t.id,
        at: t.createdAt.toISOString(),
      }));
    }
    const label = await this.labeller(chain, rows.map((r) => r.wallet).filter(Boolean), viewerId, holders.creator);
    const follows = viewerId && owners.size ? new Set((await this.prisma.db.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } })).map((f) => f.followingId)) : new Set<string>();
    return rows.slice(0, 120).map((r) => {
      const owner = owners.get(r.txHash);
      if (owner) {
        const tag: WalletTag = owner.userId === viewerId ? 'you' : follows.has(owner.userId) ? 'following' : 'magura';
        return { side: r.side, wallet: r.wallet, usd: r.usd, mcUsd: r.priceUsd && supply ? r.priceUsd * supply : null, at: r.at, txHash: r.txHash, tags: [tag], name: owner.handle };
      }
      const { tags, name } = label(r.wallet);
      return { side: r.side, wallet: r.wallet, usd: r.usd, mcUsd: r.priceUsd && supply ? r.priceUsd * supply : null, at: r.at, txHash: r.txHash, tags, name };
    });
  }

  async holders(chain: ChainId, address: string, viewerId: string | null): Promise<CoinHolder[]> {
    const { pool } = await this.market(chain, address);
    const [{ creator, holders }, early] = await Promise.all([
      this.creator(chain, address),
      // Earliest buyers we can see: for young coins the last ~300 swaps reach back to launch.
      pool
        ? this.redis
            .cachedStale(`trades:${chain}:${pool}:0`, 15, 3600, () => geckoterminal.trades(chain, pool))
            .then((t) => new Set(t.filter((x) => x.side === 'buy').slice(-20).map((x) => x.wallet)))
            .catch(() => new Set<string>())
        : Promise.resolve(new Set<string>()),
    ]);
    const label = await this.labeller(chain, holders.map((h) => h.address), viewerId, creator);
    return holders.map((h) => {
      const extra: WalletTag[] = [];
      if (h.isContract || /pool|amm|raydium|pump|uniswap|pancake|bonding/i.test(h.tag ?? '')) extra.push('pool');
      if (h.isLocked) extra.push('locked');
      if (early.has(h.address)) extra.push('early');
      const { tags, name } = label(h.address, extra);
      return { address: h.address, pct: h.pct, tags, name: name ?? (extra.includes('pool') ? h.tag ?? 'Liquidity pool' : null) };
    });
  }

  /** Buys and sells by people the viewer follows (and the viewer) — drawn as markers on the chart. */
  async friendTrades(chain: ChainId, address: string, viewerId: string | null): Promise<FriendTrade[]> {
    if (!viewerId) return [];
    const follows = await this.prisma.db.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } });
    const ids = [viewerId, ...follows.map((f) => f.followingId)];
    const trades = await this.prisma.db.trade.findMany({
      where: { chain, tokenAddress: address, userId: { in: ids }, status: { in: ['confirmed', 'pending'] } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { user: { select: { handle: true, avatarUrl: true } } },
    });
    return trades.map((t) => ({ handle: t.user.handle, avatarUrl: t.user.avatarUrl, side: t.side as 'buy' | 'sell', at: t.createdAt.toISOString(), usd: t.amountUsd != null ? Number(t.amountUsd) : null }));
  }
}

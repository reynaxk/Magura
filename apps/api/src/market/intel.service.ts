import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { solanaRpc, type LaunchTrade } from '@magura/chains';
import type { Chain } from '@magura/db';
import {
  applyTrade,
  computeIntel,
  holderRows,
  sortHolders,
  type ChainId,
  type HolderRow,
  type HolderSort,
  type LedgerEntry,
  type TokenIntel,
  type WalletTag,
  roomIds,
} from '@magura/shared';
import { env } from '../config';
import { PrismaService, RedisService } from '../common/infra.module';
import { RealtimeService } from '../realtime/realtime.service';

/** Pump.fun and the other curve launchpads mint a fixed 1B supply. */
const CURVE_SUPPLY = 1_000_000_000;
const TTL = 3 * 24 * 3600;
const ledgerKey = (c: string, a: string) => `il:${c}:${a}`;
const metaKey = (c: string, a: string) => `im:${c}:${a}`;

export type DevSellHandler = (e: { chain: ChainId; address: string; wallet: string; soldAll: boolean; at: Date }) => void | Promise<void>;

/**
 * Keeps a wallet ledger per launchpad coin from the live trade stream and turns it into
 * tags (dev / bundler / sniper / insider / fresh / early / whale) and a supply split.
 */
@Injectable()
export class IntelService implements OnModuleInit {
  private readonly log = new Logger('intel');
  private devSellHandlers: DevSellHandler[] = [];
  /** coins with new trades since the last fresh-wallet pass */
  private active = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rt: RealtimeService,
  ) {}

  onModuleInit() {
    this.onDevSell(async (e) => {
      await this.prisma.db.token.updateMany({ where: { chain: e.chain as Chain, address: e.address }, data: { devSoldAt: e.at } }).catch(() => undefined);
      this.rt.toRoom(roomIds.coin(e.chain, e.address), 'coin:devsell', { chain: e.chain, address: e.address, soldAll: e.soldAll, at: e.at.toISOString() });
    });
  }

  /** Other modules (orders, alerts) subscribe to dev sells. */
  onDevSell(fn: DevSellHandler) {
    this.devSellHandlers.push(fn);
  }

  /** A coin launched: remember when and who made it. */
  async onLaunch(chain: ChainId, address: string, creator: string | null, at: Date, curve: boolean) {
    const k = metaKey(chain, address);
    await this.redis.client
      .multi()
      .hset(k, { launchedAt: String(at.getTime()), creator: creator ?? '', supply: curve ? String(CURVE_SUPPLY) : '', buyers: '0' })
      .expire(k, TTL)
      .exec();
  }

  /** One trade from the stream. */
  async onTrade(chain: ChainId, address: string, t: LaunchTrade, at: Date) {
    const mk = metaKey(chain, address);
    const meta = await this.redis.client.hgetall(mk);
    if (!meta.launchedAt) return; // we only build ledgers for coins we saw launch
    const lk = ledgerKey(chain, address);
    const prevRaw = await this.redis.client.hget(lk, t.wallet);
    const prev = prevRaw ? (JSON.parse(prevRaw) as LedgerEntry) : null;
    const isDev = meta.creator && t.wallet === meta.creator;
    let rank = 0;
    if (t.side === 'buy' && !prev && !isDev) rank = await this.redis.client.hincrby(mk, 'buyers', 1);
    const next = applyTrade(prev, t, at.getTime() - Number(meta.launchedAt), rank);
    await this.redis.client.multi().hset(lk, t.wallet, JSON.stringify(next)).expire(lk, TTL).exec();
    this.active.add(`${chain}|${address}`);

    if (isDev && t.side === 'sell') {
      const soldAll = next.bal <= next.bt * 0.001;
      for (const h of this.devSellHandlers) void Promise.resolve(h({ chain, address, wallet: t.wallet, soldAll, at })).catch(() => undefined);
    }
    // recompute at most every 2s per coin (and always on dev moves)
    if (isDev || (await this.redis.allow(`intel:${chain}:${address}`, 1, 2))) await this.recompute(chain, address);
  }

  async ledger(chain: string, address: string): Promise<{ ledger: Record<string, LedgerEntry>; creator: string | null; supply: number | null } | null> {
    const [meta, raw] = await Promise.all([this.redis.client.hgetall(metaKey(chain, address)), this.redis.client.hgetall(ledgerKey(chain, address))]);
    if (!meta.launchedAt) return null;
    const ledger: Record<string, LedgerEntry> = {};
    for (const [w, v] of Object.entries(raw)) ledger[w] = JSON.parse(v) as LedgerEntry;
    return { ledger, creator: meta.creator || null, supply: meta.supply ? Number(meta.supply) : null };
  }

  async recompute(chain: ChainId, address: string): Promise<TokenIntel | null> {
    const l = await this.ledger(chain, address);
    if (!l) return null;
    const intel = computeIntel(l.ledger, l.creator, l.supply);
    // updateMany: the coin row may not exist yet for the launch tx itself — no error, no log noise
    await this.prisma.db.token.updateMany({ where: { chain: chain as Chain, address }, data: { intel: intel as object, holders: intel.holders } }).catch(() => undefined);
    this.rt.toRoom(`trenches:${chain}`, 'trenches:update', { chain, address, intel, holders: intel.holders });
    return intel;
  }

  /** Holder table for the coin page. Returns null when we have no ledger (non-launchpad coins). */
  async holders(chain: ChainId, address: string, sort: HolderSort, tag: WalletTag | null, priceNative: number | null, limit = 100): Promise<HolderRow[] | null> {
    const l = await this.ledger(chain, address);
    if (!l) return null;
    let rows = sortHolders(holderRows(l.ledger, l.creator, l.supply, priceNative), sort);
    if (tag) rows = rows.filter((r) => r.tags.includes(tag));
    rows = rows.slice(0, limit);
    // link wallets that belong to Magura users
    const wallets = await this.prisma.db.wallet.findMany({
      where: { address: { in: rows.map((r) => (chain === 'solana' ? r.wallet : r.wallet.toLowerCase())) } },
      select: { address: true, user: { select: { handle: true } } },
    });
    const byAddr = new Map(wallets.map((w) => [w.address.toLowerCase(), w.user.handle]));
    return rows.map((r) => {
      const handle = byAddr.get(r.wallet.toLowerCase()) ?? null;
      return handle ? { ...r, handle, tags: [...r.tags, 'magura' as WalletTag] } : r;
    });
  }

  /**
   * Fresh-wallet pass: for the biggest and earliest wallets of active coins, look up how much
   * history the wallet has. Under 10 transactions ever = fresh. Cached per wallet for a day.
   */
  @Interval(15_000)
  async freshPass() {
    if (env.NODE_ENV === 'test' || env.TRENCHES_WORKER !== '1' || !this.active.size) return;
    const coins = [...this.active].slice(0, 6);
    coins.forEach((c) => this.active.delete(c));
    let budget = 24;
    for (const c of coins) {
      const [chain, address] = c.split('|') as [ChainId, string];
      if (chain !== 'solana') continue;
      const l = await this.ledger(chain, address);
      if (!l) continue;
      const candidates = Object.entries(l.ledger)
        .filter(([w, e]) => e.fresh === undefined && w !== l.creator && ((e.rank ?? 999) <= 30 || e.bal > (l.supply ?? Infinity) * 0.01))
        .slice(0, 8);
      let changed = false;
      for (const [w, e] of candidates) {
        if (budget-- <= 0) break;
        const fresh = await this.isFresh(w);
        if (fresh == null) continue;
        e.fresh = fresh;
        await this.redis.client.hset(ledgerKey(chain, address), w, JSON.stringify(e));
        changed = true;
      }
      if (changed) await this.recompute(chain, address);
      if (budget <= 0) break;
    }
  }

  private async isFresh(wallet: string): Promise<boolean | null> {
    const k = `fw:${wallet}`;
    const hit = await this.redis.client.get(k);
    if (hit != null) return hit === '1';
    try {
      const sigs = await solanaRpc<unknown[]>('getSignaturesForAddress', [wallet, { limit: 12 }]);
      const fresh = sigs.length < 10;
      await this.redis.client.set(k, fresh ? '1' : '0', 'EX', 86_400);
      return fresh;
    } catch {
      return null;
    }
  }

  /** Dev report card: everything this creator launched that we've seen. */
  async devReport(chain: ChainId, creator: string) {
    const tokens = await this.prisma.db.token.findMany({
      where: { chain: chain as Chain, creator },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { address: true, symbol: true, name: true, imageUrl: true, createdAt: true, migratedAt: true, marketCapUsd: true, athMarketCapUsd: true, devSoldAt: true },
    });
    const migrated = tokens.filter((t) => t.migratedAt).length;
    const best = tokens.reduce<(typeof tokens)[number] | null>((b, t) => ((t.athMarketCapUsd ?? 0) > (b?.athMarketCapUsd ?? 0) ? t : b), null);
    return {
      creator,
      launched: tokens.length,
      migrated,
      migratedPct: tokens.length ? Math.round((migrated / tokens.length) * 100) : 0,
      /** coins where the dev sold within the first hour */
      quickRugs: tokens.filter((t) => t.devSoldAt && t.devSoldAt.getTime() - t.createdAt.getTime() < 3600_000).length,
      best: best ? { address: best.address, symbol: best.symbol, athMarketCapUsd: best.athMarketCapUsd } : null,
      lastLaunchAt: tokens[0]?.createdAt.toISOString() ?? null,
      tokens: tokens.map((t) => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        imageUrl: t.imageUrl,
        createdAt: t.createdAt.toISOString(),
        migrated: !!t.migratedAt,
        marketCapUsd: t.marketCapUsd,
        athMarketCapUsd: t.athMarketCapUsd,
        devSold: !!t.devSoldAt,
      })),
    };
  }
}

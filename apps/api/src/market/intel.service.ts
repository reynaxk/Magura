import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PumpLogsFeed, geckoterminal, pumpTrades, solanaRpc, type LaunchTrade, type PumpLogTrade } from '@magura/chains';
import type { Chain } from '@magura/db';
import {
  BUNDLE_WINDOW_MS,
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
const TTL = 24 * 3600;
const ledgerKey = (c: string, a: string) => `il:${c}:${a}`;
const metaKey = (c: string, a: string) => `im:${c}:${a}`;
const seenKey = (c: string, a: string) => `is:${c}:${a}`;

/** A trade from any source (live stream, pump.fun API, GeckoTerminal). */
interface IngestTrade extends LaunchTrade {
  at: Date;
  slot?: number | null;
}

/** Every ledger fill, with the realized PnL of sells (native). */
export interface WalletFill {
  chain: ChainId;
  mint: string;
  wallet: string;
  side: 'buy' | 'sell';
  native: number;
  tokens: number;
  realized: number;
  at: Date;
}
export type FillHandler = (f: WalletFill) => void;
export type IntelHandler = (e: { chain: ChainId; address: string; intel: TokenIntel; launchedAt: number }) => void;
export type LaunchHandler = (e: { chain: ChainId; address: string; creator: string; symbol: string }) => void | Promise<void>;
export type MigrateHandler = (e: { chain: ChainId; address: string; at: Date }) => void | Promise<void>;
export type DevSellHandler = (e: { chain: ChainId; address: string; wallet: string; soldAll: boolean; at: Date }) => void | Promise<void>;

/**
 * Keeps a wallet ledger per launchpad coin from the live trade stream and turns it into
 * tags (dev / bundler / sniper / insider / fresh / early / whale) and a supply split.
 */
@Injectable()
export class IntelService implements OnModuleInit {
  private readonly log = new Logger('intel');
  private devSellHandlers: DevSellHandler[] = [];
  private migrateHandlers: MigrateHandler[] = [];
  private fillHandlers: FillHandler[] = [];
  private launchHandlers: LaunchHandler[] = [];
  private intelHandlers: IntelHandler[] = [];

  onIntel(fn: IntelHandler) {
    this.intelHandlers.push(fn);
  }

  /** A coin was just created (dev snipe listens). */
  onLaunched(fn: LaunchHandler) {
    this.launchHandlers.push(fn);
  }

  launched(chain: ChainId, address: string, creator: string, symbol: string) {
    for (const h of this.launchHandlers) void Promise.resolve(h({ chain, address, creator, symbol })).catch(() => undefined);
  }

  onFill(fn: FillHandler) {
    this.fillHandlers.push(fn);
  }
  /** coins with new trades since the last fresh-wallet pass */
  private active = new Set<string>();
  /** pump.fun mints we keep ledgers for / know we don't (bounded) */
  private known = new Set<string>();
  private unknown = new Set<string>();
  private logs: PumpLogsFeed | null = null;
  private liveCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rt: RealtimeService,
  ) {}

  /** True when the on-chain pump.fun feed delivered something in the last 30s. */
  get liveFeedHealthy() {
    return !!this.logs && Date.now() - this.logs.lastMessageAt < 30_000;
  }

  /** Start the on-chain pump.fun trade feed (worker only). */
  startPumpLogs() {
    if (this.logs) return;
    this.logs = new PumpLogsFeed((t) => void this.liveTrade(t).catch(() => undefined));
    this.logs.start();
    this.log.log('pump.fun on-chain trade feed started');
    setInterval(() => {
      if (this.liveCount) this.log.log(`pump.fun feed: ${this.liveCount} trades/min ingested`);
      this.liveCount = 0;
    }, 60_000).unref();
  }

  /** A trade from the on-chain feed: only coins we track (launched in the last day). */
  private async liveTrade(t: PumpLogTrade) {
    if (this.unknown.has(t.mint)) return;
    if (!this.known.has(t.mint)) {
      const row = await this.prisma.db.token.findUnique({ where: { chain_address: { chain: 'solana', address: t.mint } }, select: { createdAt: true } });
      const track = !!row && Date.now() - row.createdAt.getTime() < 24 * 3600_000;
      const set = track ? this.known : this.unknown;
      if (set.size > 60_000) set.clear();
      set.add(t.mint);
      if (!track) return;
    }
    this.liveCount++;
    await this.ingest('solana', t.mint, [{ wallet: t.wallet, side: t.side, tokenAmount: t.tokenAmount, nativeAmount: t.solAmount, signature: t.signature, at: t.at, slot: t.slot }], true);
  }

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

  /** Other modules subscribe to a coin leaving its bonding curve. */
  onMigrate(fn: MigrateHandler) {
    this.migrateHandlers.push(fn);
  }

  migrated(chain: ChainId, address: string, at = new Date()) {
    for (const h of this.migrateHandlers) void Promise.resolve(h({ chain, address, at })).catch(() => undefined);
  }

  /** A coin launched: remember when and who made it. */
  async onLaunch(chain: ChainId, address: string, creator: string | null, at: Date, curve: boolean) {
    const k = metaKey(chain, address);
    await this.redis.client
      .multi()
      .hset(k, { launchedAt: String(at.getTime()), creator: creator ?? '', supply: curve ? String(CURVE_SUPPLY) : '', buyers: '0' })
      .expire(k, TTL)
      .exec();
    if (chain === 'solana') {
      this.unknown.delete(address);
      this.known.add(address);
    }
  }

  /** One trade from the live stream. */
  async onTrade(chain: ChainId, address: string, t: LaunchTrade, at: Date) {
    await this.ingest(chain, address, [{ ...t, at }], true);
  }

  /** Make sure a coin has ledger metadata — coins we didn't see launch get it from their DB row. */
  private async ensureMeta(chain: ChainId, address: string): Promise<Record<string, string> | null> {
    const mk = metaKey(chain, address);
    const meta = await this.redis.client.hgetall(mk);
    if (meta.launchedAt) return meta;
    const row = await this.prisma.db.token.findUnique({ where: { chain_address: { chain: chain as Chain, address } }, select: { createdAt: true, creator: true, launchpad: true } });
    if (!row) return null;
    const curve = ['pumpfun', 'fourmeme', 'flap', 'pons'].includes(row.launchpad ?? '');
    await this.onLaunch(chain, address, row.creator, row.createdAt, curve);
    return this.redis.client.hgetall(mk);
  }

  /**
   * Apply trades (any order, duplicates ignored) to a coin's ledger.
   * Same slot as the launch = bundle. `live` trades can fire dev-sell automations; backfilled ones can't.
   */
  async ingest(chain: ChainId, address: string, trades: IngestTrade[], live = false) {
    if (!trades.length) return;
    const meta = await this.ensureMeta(chain, address);
    if (!meta) return;
    const mk = metaKey(chain, address);
    const lk = ledgerKey(chain, address);
    const sk = seenKey(chain, address);
    const launchedAt = Number(meta.launchedAt);
    const creator = meta.creator || null;
    const sorted = [...trades].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.slot ?? 0) - (b.slot ?? 0));
    // the launch slot: the dev's first trade (create + initial buy share a tx), else the oldest trade we know
    let launchSlot = meta.launchSlot ? Number(meta.launchSlot) : null;
    if (launchSlot == null) {
      const devFirst = sorted.find((t) => t.slot != null && t.wallet === creator);
      if (devFirst?.slot != null) {
        launchSlot = devFirst.slot;
        await this.redis.client.hset(mk, 'launchSlot', String(launchSlot));
      }
    }
    let changed = false;
    let devSold: { wallet: string; soldAll: boolean; at: Date } | null = null;
    for (const t of sorted) {
      // backfills can overlap each other; the live feed never repeats a trade
      if (t.signature && !live) {
        const fresh = await this.redis.client.sadd(sk, t.signature);
        if (!fresh) continue;
      }
      const prevRaw = await this.redis.client.hget(lk, t.wallet);
      const prev = prevRaw ? (JSON.parse(prevRaw) as LedgerEntry) : null;
      const isDev = !!creator && t.wallet === creator;
      let rank = 0;
      if (t.side === 'buy' && !prev && !isDev) rank = await this.redis.client.hincrby(mk, 'buyers', 1);
      let ms = t.at.getTime() - launchedAt;
      if (t.slot != null && launchSlot != null) ms = t.slot === launchSlot ? 0 : Math.max(ms, BUNDLE_WINDOW_MS + 1);
      const next = applyTrade(prev, t, ms, rank);
      await this.redis.client.hset(lk, t.wallet, JSON.stringify(next));
      if (this.fillHandlers.length) {
        // realized PnL of a sell = proceeds − average cost of the tokens sold (only what we saw them buy)
        const avgCost = prev && prev.bt > 0 ? prev.ni / prev.bt : 0;
        const soldKnown = prev ? Math.min(t.tokenAmount, prev.bal) : 0;
        const realized = t.side === 'sell' && prev && prev.bt > 0 ? (t.nativeAmount * soldKnown) / Math.max(t.tokenAmount, 1e-9) - avgCost * soldKnown : 0;
        const fill: WalletFill = { chain, mint: address, wallet: t.wallet, side: t.side, native: t.nativeAmount, tokens: t.tokenAmount, realized, at: t.at };
        for (const h of this.fillHandlers) h(fill);
      }
      changed = true;
      if (isDev && t.side === 'sell') devSold = { wallet: t.wallet, soldAll: next.bal <= next.bt * 0.001, at: t.at };
    }
    if (!changed) return;
    await this.redis.client.multi().expire(lk, TTL).expire(sk, TTL).expire(mk, TTL).exec();
    this.active.add(`${chain}|${address}`);
    // backfilled dev sells still mark the coin, but only fresh ones (≤2 min) trigger automations
    if (devSold && (live || Date.now() - devSold.at.getTime() < 120_000)) {
      for (const h of this.devSellHandlers) void Promise.resolve(h({ chain, address, wallet: devSold.wallet, soldAll: devSold.soldAll, at: devSold.at })).catch(() => undefined);
    } else if (devSold) {
      await this.prisma.db.token.updateMany({ where: { chain: chain as Chain, address, devSoldAt: null }, data: { devSoldAt: devSold.at } }).catch(() => undefined);
    }
    if (devSold || !live || (await this.redis.allow(`intel:${chain}:${address}`, 1, 5))) await this.recompute(chain, address);
  }

  /** Pull recent trades for a coin: pump.fun's API (with slots) for pump coins, GeckoTerminal otherwise. */
  async backfill(chain: ChainId, address: string, opts: { allowGecko?: boolean } = {}): Promise<boolean> {
    const row = await this.prisma.db.token.findUnique({ where: { chain_address: { chain: chain as Chain, address } }, select: { launchpad: true, pairAddress: true, migratedAt: true } });
    if (!row) return false;
    // pump.fun's API is the best source for curve coins; if it pushes back we use GeckoTerminal for a minute
    const pumpOk = row.launchpad === 'pumpfun' && !(await this.redis.client.exists('intel:cooldown'));
    try {
      if (pumpOk) {
        const trades = await pumpTrades(address, 200);
        await this.ingest(
          chain,
          address,
          trades.map((t) => ({ wallet: t.wallet, side: t.side, tokenAmount: t.tokenAmount, nativeAmount: t.solAmount, signature: t.signature, at: t.at, slot: t.slot })),
        );
        return true;
      }
      // GeckoTerminal is shared with charts: only for someone actually looking at the coin
      if (!row.pairAddress || !opts.allowGecko) return false;
      const trades = await geckoterminal.trades(chain, row.pairAddress);
      await this.ingest(
        chain,
        address,
        trades
          .filter((t) => t.tokenAmount != null)
          .map((t) => ({ wallet: t.wallet, side: t.side, tokenAmount: t.tokenAmount!, nativeAmount: t.quoteAmount ?? 0, signature: t.txHash, at: new Date(t.at), slot: t.block })),
      );
      return true;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (pumpOk && (status === 429 || status === 403 || status === 530)) {
        // 403 = their firewall blocks our server IP; that won't change in a minute
        const ttl = status === 403 ? 1800 : 60;
        await this.redis.client.set('intel:cooldown', '1', 'EX', ttl);
        this.log.warn(`pump.fun trades API refused (${status}) — GeckoTerminal only for ${ttl / 60}m`);
      } else this.log.debug(`backfill ${chain}:${address} failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Someone opened this coin — keep its ledger fresh while they look. */
  async touch(chain: ChainId, address: string) {
    if (chain === 'solana' && this.liveFeedHealthy && this.known.has(address)) return; // already streaming
    await this.redis.client.zadd('intel:viewed', Date.now(), `${chain}|${address}`);
    if (await this.redis.allow(`ib:${chain}:${address}`, 1, 8)) await this.backfill(chain, address, { allowGecko: true });
  }

  /**
   * Background backfill: coins people are looking at first, then the hottest launchpad coins.
   * ~20 pump.fun calls a minute; GeckoTerminal calls go through its shared budget.
   */
  @Interval(6_000)
  async backfillPass() {
    if (env.NODE_ENV === 'test' || env.TRENCHES_WORKER !== '1' || this.liveFeedHealthy) return;
    const since = Date.now() - 120_000;
    const viewed = (await this.redis.client.zrangebyscore('intel:viewed', since, '+inf')).map((k) => k.split('|') as [ChainId, string]);
    await this.redis.client.zremrangebyscore('intel:viewed', 0, since);
    const hot = await this.prisma.db.token.findMany({
      where: { launchpad: 'pumpfun', migratedAt: null, createdAt: { gte: new Date(Date.now() - 3 * 3600_000) }, marketCapUsd: { gte: 6_000 } },
      orderBy: [{ marketCapUsd: 'desc' }],
      take: 40,
      select: { chain: true, address: true },
    });
    const queue = [...viewed, ...hot.map((t) => [t.chain as ChainId, t.address] as [ChainId, string])];
    // pump.fun only, at most 2 calls per pass whatever happens; nothing while it's cooling down
    if (await this.redis.client.exists('intel:cooldown')) return;
    let tries = 0;
    for (const [chain, address] of queue) {
      if (tries >= 2) break;
      if (!(await this.redis.allow(`ib:${chain}:${address}`, 1, 25))) continue;
      tries++;
      await this.backfill(chain, address);
    }
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
    const launchedAt = Number((await this.redis.client.hget(metaKey(chain, address), 'launchedAt')) ?? 0);
    for (const h of this.intelHandlers) h({ chain, address, intel, launchedAt });
    return intel;
  }

  /** Holder table for the coin page. Returns null when we have no ledger (non-launchpad coins). */
  async holders(chain: ChainId, address: string, sort: HolderSort, tag: WalletTag | null, priceNative: number | null, limit = 100): Promise<HolderRow[] | null> {
    await this.touch(chain, address).catch(() => undefined);
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

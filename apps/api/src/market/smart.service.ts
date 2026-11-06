import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Chain } from '@magura/db';
import type { ChainId } from '@magura/shared';
import { env } from '../config';
import { PrismaService, RedisService } from '../common/infra.module';
import { IntelService, type WalletFill } from './intel.service';

const DAY_TTL = 32 * 86400;
const day = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '');
const days = (n: number) => Array.from({ length: n }, (_, i) => day(new Date(Date.now() - i * 86400_000)));

export type Window = '1d' | '7d' | '30d';
const WINDOW_DAYS: Record<Window, number> = { '1d': 1, '7d': 7, '30d': 30 };

export interface WalletStats {
  wallet: string;
  pnl: number;
  buys: number;
  sells: number;
  wins: number;
  winRate: number | null;
  volume: number;
  coins: number;
  handle?: string | null;
  smart?: boolean;
}

/** Smart wallets: profitable and consistent over the last 7 days. */
const SMART = { minPnl: 5, minWinRate: 55, minSells: 8 };

/**
 * Wallet leaderboard built from every trade in the launch ledgers (pump.fun on-chain feed).
 * Daily buckets in Redis: rank (realized PnL), counts, volume, coins touched.
 */
@Injectable()
export class SmartService implements OnModuleInit {
  private readonly log = new Logger('smart');
  private smart = new Set<string>();

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly intel: IntelService,
  ) {}

  onModuleInit() {
    this.intel.onFill((f) => void this.record(f).catch(() => undefined));
    void this.refreshSmart().catch(() => undefined);
  }

  isSmart(wallet: string) {
    return this.smart.has(wallet);
  }

  private async record(f: WalletFill) {
    if (f.chain !== 'solana') return;
    const d = day(f.at);
    const r = this.redis.client.multi();
    const stat = `wst:${d}:${f.wallet}`;
    r.hincrbyfloat(stat, 'vol', f.native);
    r.hincrby(stat, f.side === 'buy' ? 'buys' : 'sells', 1);
    if (f.side === 'sell') {
      r.zincrby(`wrank:${d}`, f.realized, f.wallet);
      r.hincrbyfloat(stat, 'pnl', f.realized);
      if (f.realized > 0) r.hincrby(stat, 'wins', 1);
    } else r.zincrby(`wrank:${d}`, 0, f.wallet);
    r.sadd(`wcoins:${d}:${f.wallet}`, f.mint);
    r.expire(stat, DAY_TTL).expire(`wrank:${d}`, DAY_TTL).expire(`wcoins:${d}:${f.wallet}`, DAY_TTL);
    // personal trade tape (wallet page)
    r.lpush(`wtx:${f.wallet}`, JSON.stringify({ m: f.mint, s: f.side, n: +f.native.toFixed(4), t: Math.round(f.tokens), r: +f.realized.toFixed(4), at: f.at.getTime() }));
    r.ltrim(`wtx:${f.wallet}`, 0, 199).expire(`wtx:${f.wallet}`, 7 * 86400);
    // smart money flow: what smart wallets buy, per minute bucket
    if (f.side === 'buy' && this.smart.has(f.wallet)) {
      const minute = Math.floor(f.at.getTime() / 60_000);
      r.zincrby(`sflow:${minute}`, f.native, f.mint).expire(`sflow:${minute}`, 7200);
      r.sadd(`sflowW:${minute}:${f.mint}`, f.wallet).expire(`sflowW:${minute}:${f.mint}`, 7200);
    }
    await r.exec();
  }

  /** Stats for many wallets over a window. */
  private async statsFor(wallets: string[], window: Window): Promise<WalletStats[]> {
    const ds = days(WINDOW_DAYS[window]);
    const p = this.redis.client.pipeline();
    for (const w of wallets) for (const d of ds) p.hgetall(`wst:${d}:${w}`);
    for (const w of wallets) p.sunion(...ds.map((d) => `wcoins:${d}:${w}`));
    const res = (await p.exec()) ?? [];
    const out: WalletStats[] = wallets.map((wallet, wi) => {
      const acc = { pnl: 0, buys: 0, sells: 0, wins: 0, vol: 0 };
      ds.forEach((_, di) => {
        const h = (res[wi * ds.length + di]?.[1] ?? {}) as Record<string, string>;
        acc.pnl += Number(h.pnl ?? 0);
        acc.buys += Number(h.buys ?? 0);
        acc.sells += Number(h.sells ?? 0);
        acc.wins += Number(h.wins ?? 0);
        acc.vol += Number(h.vol ?? 0);
      });
      const coins = ((res[wallets.length * ds.length + wi]?.[1] ?? []) as string[]).length;
      return { wallet, pnl: acc.pnl, buys: acc.buys, sells: acc.sells, wins: acc.wins, winRate: acc.sells ? Math.round((acc.wins / acc.sells) * 1000) / 10 : null, volume: acc.vol, coins, smart: this.smart.has(wallet) };
    });
    // link Magura users
    const users = await this.prisma.db.wallet.findMany({ where: { address: { in: wallets } }, select: { address: true, user: { select: { handle: true } } } });
    const byAddr = new Map(users.map((u) => [u.address, u.user.handle]));
    return out.map((o) => ({ ...o, handle: byAddr.get(o.wallet) ?? null }));
  }

  /** Top wallets by realized PnL (or win rate / volume) over 1d / 7d / 30d. */
  async rank(window: Window, sort: 'pnl' | 'winrate' | 'volume', limit = 100) {
    return this.redis.cached(`wrank:v1:${window}:${sort}`, 60, async () => {
      const ds = days(WINDOW_DAYS[window]);
      const key = `wrank:u:${window}`;
      await this.redis.client.zunionstore(key, ds.length, ...ds.map((d) => `wrank:${d}`));
      await this.redis.client.expire(key, 120);
      const top = await this.redis.client.zrevrange(key, 0, sort === 'pnl' ? limit - 1 : 499);
      let rows = await this.statsFor(top, window);
      // bots that trade thousands of times aren't "smart money"
      rows = rows.filter((r) => r.sells >= 3 && r.buys + r.sells < 5000);
      if (sort === 'winrate') rows.sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.pnl - a.pnl);
      if (sort === 'volume') rows.sort((a, b) => b.volume - a.volume);
      return rows.slice(0, limit);
    });
  }

  /** Recompute the smart-wallet set every 5 minutes. */
  @Interval(300_000)
  async refreshSmart() {
    if (env.NODE_ENV === 'test') return;
    const rows = await this.rank('7d', 'pnl', 500);
    const next = new Set(rows.filter((r) => r.pnl >= SMART.minPnl && (r.winRate ?? 0) >= SMART.minWinRate && r.sells >= SMART.minSells).map((r) => r.wallet));
    this.smart = next;
    if (next.size) this.log.log(`smart wallets: ${next.size}`);
  }

  /** Coins smart wallets are buying over the last N minutes. */
  async flow(minutes: number) {
    const now = Math.floor(Date.now() / 60_000);
    const keys = Array.from({ length: minutes }, (_, i) => `sflow:${now - i}`);
    const agg = new Map<string, number>();
    const p = this.redis.client.pipeline();
    for (const k of keys) p.zrange(k, 0, -1, 'WITHSCORES');
    for (const [, v] of (await p.exec()) ?? []) {
      const arr = (v ?? []) as string[];
      for (let i = 0; i < arr.length; i += 2) agg.set(arr[i], (agg.get(arr[i]) ?? 0) + Number(arr[i + 1]));
    }
    const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    if (!top.length) return [];
    const wp = this.redis.client.pipeline();
    for (const [mint] of top) wp.sunion(...keys.map((k) => `sflowW:${k.split(':')[1]}:${mint}`));
    const wres = (await wp.exec()) ?? [];
    const tokens = await this.prisma.db.token.findMany({
      where: { chain: 'solana' as Chain, address: { in: top.map(([m]) => m) } },
      select: { address: true, symbol: true, name: true, imageUrl: true, marketCapUsd: true, createdAt: true, priceChange1h: true, intel: true },
    });
    const byAddr = new Map(tokens.map((t) => [t.address, t]));
    return top
      .map(([mint, sol], i) => ({ chain: 'solana' as ChainId, address: mint, smartBuySol: sol, smartWallets: ((wres[i]?.[1] ?? []) as string[]).length, token: byAddr.get(mint) ?? null }))
      .filter((r) => r.token);
  }

  /** Wallets that traded every one of these coins (Radar). */
  async radar(chain: ChainId, mints: string[]) {
    const p = this.redis.client.pipeline();
    for (const m of mints) p.hgetall(`il:${chain}:${m}`);
    const res = (await p.exec()) ?? [];
    const ledgers = res.map((r) => (r?.[1] ?? {}) as Record<string, string>);
    if (ledgers.some((l) => !Object.keys(l).length)) return { missing: mints.filter((_, i) => !Object.keys(ledgers[i]).length), wallets: [] };
    let common = new Set(Object.keys(ledgers[0]));
    for (const l of ledgers.slice(1)) common = new Set([...common].filter((w) => w in l));
    const wallets = [...common].slice(0, 200).map((w) => {
      const per = ledgers.map((l) => JSON.parse(l[w]) as { ni: number; no: number; bal: number; first: number | null });
      return {
        wallet: w,
        spent: per.reduce((a, e) => a + e.ni, 0),
        received: per.reduce((a, e) => a + e.no, 0),
        holdingIn: per.filter((e) => e.bal > 0).length,
        earliestMs: Math.min(...per.map((e) => e.first ?? Infinity)),
        smart: this.smart.has(w),
      };
    });
    wallets.sort((a, b) => b.spent - a.spent);
    return { missing: [], wallets };
  }

  /** Wallet page: stats per window, recent trades, coins still held. */
  async wallet(chain: ChainId, address: string) {
    const [d1, d7, d30] = await Promise.all([this.statsFor([address], '1d'), this.statsFor([address], '7d'), this.statsFor([address], '30d')]);
    const raw = await this.redis.client.lrange(`wtx:${address}`, 0, 99);
    const tape = raw.map((x) => JSON.parse(x) as { m: string; s: 'buy' | 'sell'; n: number; t: number; r: number; at: number });
    const mints = [...new Set(tape.map((t) => t.m))];
    const tokens = await this.prisma.db.token.findMany({ where: { chain: chain as Chain, address: { in: mints } }, select: { address: true, symbol: true, imageUrl: true, marketCapUsd: true, priceUsd: true } });
    const tok = new Map(tokens.map((t) => [t.address, t]));
    // still holding: read their ledger row on each coin
    const p = this.redis.client.pipeline();
    for (const m of mints) p.hget(`il:${chain}:${m}`, address);
    const rows = ((await p.exec()) ?? []).map((r) => (r?.[1] ? (JSON.parse(r[1] as string) as { bal: number; ni: number; no: number; bt: number }) : null));
    const holdings = mints
      .map((m, i) => ({ mint: m, e: rows[i] }))
      .filter((x) => x.e && x.e.bal > 0)
      .map((x) => ({ address: x.mint, symbol: tok.get(x.mint)?.symbol ?? '?', imageUrl: tok.get(x.mint)?.imageUrl ?? null, balance: x.e!.bal, spent: x.e!.ni, received: x.e!.no, marketCapUsd: tok.get(x.mint)?.marketCapUsd ?? null }));
    return {
      wallet: address,
      handle: d7[0]?.handle ?? null,
      smart: this.smart.has(address),
      windows: { '1d': d1[0], '7d': d7[0], '30d': d30[0] },
      holdings,
      trades: tape.map((t) => ({ address: t.m, symbol: tok.get(t.m)?.symbol ?? '?', imageUrl: tok.get(t.m)?.imageUrl ?? null, side: t.s, native: t.n, tokens: t.t, realized: t.r, at: new Date(t.at).toISOString() })),
    };
  }
}

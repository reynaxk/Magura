import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Chain } from '@magura/db';
import type { ChainId, SignalDTO, SignalKind } from '@magura/shared';
import { PrismaService, RedisService } from '../common/infra.module';
import { RealtimeService } from '../realtime/realtime.service';
import { IntelService } from './intel.service';
import { SmartService } from './smart.service';

const LIST = 'signals';
const KEEP = 400;
const WHALE_SOL = 5;
const SMART_MIN_SOL = 0.3;

/**
 * Monitor: turns ledger fills, dev sells, migrations and DexScreener payments into a live
 * signal feed — whale buys, smart-money buys, dev dumps, bundled launches, migrations.
 */
@Injectable()
export class SignalsService implements OnModuleInit {
  private tokenCache = new Map<string, { symbol: string; imageUrl: string | null; marketCapUsd: number | null; at: number }>();
  /** Solana wallets users track → who tracks them and under what name */
  private tracked = new Map<string, { userId: string; label: string }[]>();
  private listeners: ((s: SignalDTO) => void)[] = [];

  /** Subscribe to every public signal as it is emitted. */
  onSignal(fn: (s: SignalDTO) => void) {
    this.listeners.push(fn);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rt: RealtimeService,
    private readonly intel: IntelService,
    private readonly smart: SmartService,
  ) {}

  onModuleInit() {
    void this.refreshTracked();
    this.intel.onFill((f) => {
      if (this.tracked.has(f.wallet) && Date.now() - f.at.getTime() < 120_000) void this.trackedFill(f.chain, f.mint, f.wallet, f.side, f.native);
      if (f.side !== 'buy') return;
      if (f.native >= WHALE_SOL) void this.push('whale_buy', f.chain, f.mint, { native: f.native, wallet: f.wallet, detail: `Bought ${f.native.toFixed(2)} SOL in one trade` }, 20);
      else if (f.native >= SMART_MIN_SOL && this.smart.isSmart(f.wallet))
        void this.push('smart_buy', f.chain, f.mint, { native: f.native, wallet: f.wallet, detail: `Smart wallet bought ${f.native.toFixed(2)} SOL` }, 15);
    });
    this.intel.onDevSell((e) => void this.push('dev_sell', e.chain, e.address, { wallet: e.wallet, detail: e.soldAll ? 'Dev sold everything' : 'Dev is selling' }, 60));
    this.intel.onMigrate((e) => void this.push('migrated', e.chain, e.address, { detail: 'Left the bonding curve — now on a DEX' }, 3600));
    this.intel.onIntel((e) => {
      const ageMs = Date.now() - e.launchedAt;
      if (ageMs < 90_000 && (e.intel.bundlerPct ?? 0) >= 20 && e.intel.bundlers >= 3)
        void this.push('bundled_launch', e.chain, e.address, { detail: `${e.intel.bundlers} bundlers hold ${Math.round(e.intel.bundlerPct ?? 0)}% at launch` }, 3600);
    });
  }

  @Interval(60_000)
  async refreshTracked() {
    const rows = await this.prisma.db.trackedWallet.findMany({ where: { chainKind: 'svm' }, select: { userId: true, address: true, label: true } });
    const m = new Map<string, { userId: string; label: string }[]>();
    for (const r of rows) m.set(r.address, [...(m.get(r.address) ?? []), { userId: r.userId, label: r.label }]);
    this.tracked = m;
  }

  /** A wallet someone tracks just traded → straight to them (toast + Monitor → Tracked). */
  private async trackedFill(chain: ChainId, mint: string, wallet: string, side: 'buy' | 'sell', native: number) {
    const t = await this.token(chain, mint);
    if (!t) return;
    for (const w of this.tracked.get(wallet) ?? []) {
      const s: SignalDTO = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        kind: 'tracked',
        chain,
        address: mint,
        symbol: t.symbol,
        imageUrl: t.imageUrl,
        marketCapUsd: t.marketCapUsd,
        native,
        wallet,
        label: w.label,
        side,
        detail: `${w.label} ${side === 'buy' ? 'bought' : 'sold'} ${native.toFixed(2)} SOL`,
        at: new Date().toISOString(),
      };
      this.rt.toUser(w.userId, 'signal', s);
      await this.redis.client.multi().lpush(`trk:${w.userId}`, JSON.stringify(s)).ltrim(`trk:${w.userId}`, 0, 199).expire(`trk:${w.userId}`, 7 * 86400).exec();
    }
  }

  async trackedFor(userId: string): Promise<SignalDTO[]> {
    return (await this.redis.client.lrange(`trk:${userId}`, 0, 199)).map((r) => JSON.parse(r) as SignalDTO);
  }

  /** Called by Trenches when DexScreener reports a payment. */
  dexPaid(chain: ChainId, address: string) {
    void this.push('dex_paid', chain, address, { detail: 'Team paid for DexScreener' }, 86_400);
  }

  private async token(chain: ChainId, address: string) {
    const k = `${chain}:${address}`;
    const hit = this.tokenCache.get(k);
    if (hit && Date.now() - hit.at < 30_000) return hit;
    const t = await this.prisma.db.token.findUnique({ where: { chain_address: { chain: chain as Chain, address } }, select: { symbol: true, imageUrl: true, marketCapUsd: true } });
    if (!t) return null;
    const v = { ...t, at: Date.now() };
    if (this.tokenCache.size > 5000) this.tokenCache.clear();
    this.tokenCache.set(k, v);
    return v;
  }

  /** One signal per coin per kind per `quietSec`. */
  private async push(kind: SignalKind, chain: ChainId, address: string, extra: { native?: number; wallet?: string; detail: string }, quietSec: number) {
    if (!(await this.redis.allow(`sig:${kind}:${address}`, 1, quietSec))) return;
    const t = await this.token(chain, address);
    if (!t) return;
    const s: SignalDTO = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind,
      chain,
      address,
      symbol: t.symbol,
      imageUrl: t.imageUrl,
      marketCapUsd: t.marketCapUsd,
      native: extra.native ?? null,
      wallet: extra.wallet ?? null,
      detail: extra.detail,
      at: new Date().toISOString(),
    };
    await this.redis.client.multi().lpush(LIST, JSON.stringify(s)).ltrim(LIST, 0, KEEP - 1).exec();
    this.rt.toRoom(`trenches:${chain}`, 'signal', s);
    for (const fn of this.listeners) fn(s);
  }

  async recent(kinds: SignalKind[] | null, limit = 150): Promise<SignalDTO[]> {
    const raw = await this.redis.client.lrange(LIST, 0, KEEP - 1);
    const all = raw.map((r) => JSON.parse(r) as SignalDTO);
    return (kinds?.length ? all.filter((s) => kinds.includes(s.kind)) : all).slice(0, limit);
  }
}

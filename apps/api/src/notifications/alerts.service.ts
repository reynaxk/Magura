import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { evmClient, solanaRpc } from '@magura/chains';
import type { Trade } from '@magura/db';
import { CHAINS, type ChainId } from '@magura/shared';
import { env } from '../config';
import { PrismaService, RedisService } from '../common/infra.module';
import { TradingService } from '../trading/trading.service';
import { NotificationsService } from './notifications.module';

/** Mints and tokens that are money, not coins — moving them isn't a "buy" or "sell". */
const BASE_ASSETS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  '0x4200000000000000000000000000000000000006', // WETH base
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC base
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  '0x55d398326f99059ff775485246999027b3197955', // USDT bsc
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC bsc
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
]);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}` as `0x${string}`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * Alerts that bring people back:
 * - a tracked wallet buys or sells
 * - someone you follow buys a coin you hold
 * - a coin you hold gets a loud room
 */
@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly log = new Logger('alerts');
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly trading: TradingService,
    private readonly notify: NotificationsService,
  ) {}

  onModuleInit() {
    this.trading.onConfirmed((t) => this.friendBought(t));
  }

  /** Throttle: true at most once per key per window. */
  private async once(key: string, seconds: number) {
    return (await this.redis.client.set(`alert:${key}`, '1', 'EX', seconds, 'NX')) === 'OK';
  }

  private async holders(chain: ChainId, token: string, exceptUserId?: string) {
    const rows = await this.prisma.db.trade.findMany({
      where: { chain, tokenAddress: token, side: 'buy', status: 'confirmed', createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) },
      distinct: ['userId'],
      select: { userId: true },
      take: 500,
    });
    return rows.map((r) => r.userId);
  }

  private async friendBought(t: Trade) {
    if (t.side !== 'buy') return;
    const chain = t.chain as ChainId;
    const [followers, holders, who] = await Promise.all([
      this.prisma.db.follow.findMany({ where: { followingId: t.userId }, select: { followerId: true } }),
      this.holders(chain, t.tokenAddress, t.userId),
      this.prisma.db.user.findUnique({ where: { id: t.userId }, select: { handle: true } }),
    ]);
    const holding = new Set(holders);
    for (const f of followers) {
      if (!holding.has(f.followerId)) continue;
      if (!(await this.once(`friend:${f.followerId}:${t.tokenAddress}`, 3600))) continue;
      const usd = t.amountUsd ? ` for $${Number(t.amountUsd).toFixed(0)}` : '';
      await this.notify.notify(f.followerId, 'alert', `@${who?.handle} bought ${t.tokenSymbol}`, `Someone you follow just bought a coin you hold${usd}`, `/t/${chain}/${t.tokenAddress}`);
    }
  }

  /** Coin rooms with a burst of messages → tell people who hold that coin. */
  @Interval(120_000)
  async loudRooms() {
    const rows = await this.prisma.db.message.groupBy({
      by: ['roomId'],
      where: { roomId: { startsWith: 'coin:' }, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
      _count: { _all: true },
      having: { roomId: { _count: { gte: 25 } } },
    });
    for (const r of rows) {
      const room = await this.prisma.db.room.findUnique({ where: { id: r.roomId }, select: { chain: true, tokenAddress: true } });
      if (!room?.chain || !room.tokenAddress) continue;
      const tok = await this.prisma.db.token.findUnique({ where: { chain_address: { chain: room.chain, address: room.tokenAddress } }, select: { symbol: true } });
      for (const userId of await this.holders(room.chain as ChainId, room.tokenAddress)) {
        if (!(await this.once(`loud:${userId}:${r.roomId}`, 6 * 3600))) continue;
        await this.notify.notify(userId, 'alert', `$${tok?.symbol ?? 'Coin'} room is heating up`, `${r._count._all} messages in the last 10 minutes`, `/t/${room.chain}/${room.tokenAddress}`);
      }
    }
  }

  /** Watch tracked wallets on-chain and alert the people tracking them. */
  @Interval(30_000)
  async watchWallets() {
    if (this.busy || env.TRENCHES_WORKER === '0') return;
    this.busy = true;
    try {
      const tracked = await this.prisma.db.trackedWallet.findMany({ where: { alerts: true }, select: { userId: true, chainKind: true, address: true, label: true }, take: 2000 });
      const byAddr = new Map<string, typeof tracked>();
      for (const t of tracked) byAddr.set(`${t.chainKind}:${t.address}`, [...(byAddr.get(`${t.chainKind}:${t.address}`) ?? []), t]);
      const sol = [...byAddr.keys()].filter((k) => k.startsWith('svm:')).map((k) => k.slice(4)).slice(0, 300);
      const evm = [...byAddr.keys()].filter((k) => k.startsWith('evm:')).map((k) => k.slice(4)).slice(0, 300);
      const events: { kind: 'svm' | 'evm'; chain: ChainId; wallet: string; token: string; side: 'buy' | 'sell' }[] = [];
      for (const a of sol) events.push(...(await this.solanaMoves(a).catch(() => [])));
      if (evm.length) for (const chain of ['base', 'bsc', 'ethereum'] as const) events.push(...(await this.evmMoves(chain, evm).catch(() => [])));

      for (const e of events) {
        const watchers = byAddr.get(`${e.kind}:${e.wallet}`) ?? [];
        const tok = await this.prisma.db.token.findUnique({ where: { chain_address: { chain: e.chain, address: e.token } }, select: { symbol: true } });
        const sym = tok?.symbol ?? short(e.token);
        for (const w of watchers) {
          if (!(await this.once(`wallet:${w.userId}:${e.wallet}:${e.token}:${e.side}`, 600))) continue;
          await this.notify.notify(w.userId, 'alert', `${w.label} ${e.side === 'buy' ? 'bought' : 'sold'} ${sym}`, `Tracked wallet ${short(e.wallet)} on ${CHAINS[e.chain].name}`, `/t/${e.chain}/${e.token}`);
        }
      }
    } catch (err) {
      this.log.warn(`watch failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async solanaMoves(addr: string) {
    const key = `watch:sol:${addr}`;
    const last = await this.redis.client.get(key);
    const sigs = await solanaRpc<{ signature: string; err: unknown }[]>('getSignaturesForAddress', [addr, { limit: 10, ...(last ? { until: last } : {}) }]);
    if (!sigs.length) return [];
    await this.redis.client.set(key, sigs[0].signature);
    if (!last) return []; // first look: remember where we are, don't replay history
    const out: { kind: 'svm'; chain: ChainId; wallet: string; token: string; side: 'buy' | 'sell' }[] = [];
    for (const s of sigs.filter((x) => !x.err).slice(0, 5)) {
      const tx = await solanaRpc<any>('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => null);
      if (!tx?.meta) continue;
      const delta = new Map<string, bigint>();
      for (const b of tx.meta.preTokenBalances ?? []) if (b.owner === addr) delta.set(b.mint, (delta.get(b.mint) ?? 0n) - BigInt(b.uiTokenAmount.amount));
      for (const b of tx.meta.postTokenBalances ?? []) if (b.owner === addr) delta.set(b.mint, (delta.get(b.mint) ?? 0n) + BigInt(b.uiTokenAmount.amount));
      for (const [mint, d] of delta) {
        if (d === 0n || BASE_ASSETS.has(mint)) continue;
        out.push({ kind: 'svm', chain: 'solana', wallet: addr, token: mint, side: d > 0n ? 'buy' : 'sell' });
      }
    }
    return out;
  }

  private async evmMoves(chain: 'base' | 'bsc' | 'ethereum', addrs: string[]) {
    const c = evmClient(chain);
    const head = await c.getBlockNumber();
    const key = `watch:evm:${chain}`;
    const lastRaw = await this.redis.client.get(key);
    await this.redis.client.set(key, head.toString());
    if (!lastRaw) return [];
    const from = BigInt(lastRaw) + 1n;
    if (from > head) return [];
    const fromBlock = head - from > 200n ? head - 200n : from; // cap the range after downtime
    const topics = addrs.map(pad);
    const [incoming, outgoing] = await Promise.all([
      c.request({ method: 'eth_getLogs', params: [{ fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${head.toString(16)}`, topics: [TRANSFER, null, topics] }] } as any) as Promise<any[]>,
      c.request({ method: 'eth_getLogs', params: [{ fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${head.toString(16)}`, topics: [TRANSFER, topics] }] } as any) as Promise<any[]>,
    ]);
    const out: { kind: 'evm'; chain: ChainId; wallet: string; token: string; side: 'buy' | 'sell' }[] = [];
    const seen = new Set<string>();
    const add = (log: any, side: 'buy' | 'sell') => {
      const token = String(log.address).toLowerCase();
      if (BASE_ASSETS.has(token)) return;
      const wallet = `0x${String(log.topics[side === 'buy' ? 2 : 1]).slice(26)}`.toLowerCase();
      const k = `${wallet}:${token}:${side}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ kind: 'evm', chain, wallet, token, side });
    };
    for (const l of incoming ?? []) add(l, 'buy');
    for (const l of outgoing ?? []) add(l, 'sell');
    return out;
  }
}

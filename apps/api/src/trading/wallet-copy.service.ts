import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { WalletCopy } from '@magura/db';
import { PrismaService, RedisService } from '../common/infra.module';
import { IntelService, type WalletFill } from '../market/intel.service';
import { OrdersService } from './orders.service';
import { copyDecision } from './wallet-copy.rules';

/**
 * Wallet copy: mirror any Solana wallet's pump.fun trades from the live on-chain feed.
 * Executes through the order engine (delegated wallet, or confirm in app).
 */
@Injectable()
export class WalletCopyService implements OnModuleInit {
  private readonly log = new Logger('wallet-copy');
  private byWallet = new Map<string, WalletCopy[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly intel: IntelService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    void this.refresh();
    this.intel.onFill((f) => {
      if (f.chain !== 'solana' || !this.byWallet.has(f.wallet) || Date.now() - f.at.getTime() > 60_000) return;
      void this.handle(f).catch((e) => this.log.warn(`copy failed: ${(e as Error).message}`));
    });
  }

  @Interval(30_000)
  async refresh() {
    const rows = await this.prisma.db.walletCopy.findMany({ where: { status: 'active' } });
    const m = new Map<string, WalletCopy[]>();
    for (const r of rows) m.set(r.wallet, [...(m.get(r.wallet) ?? []), r]);
    this.byWallet = m;
  }

  private async handle(f: WalletFill) {
    const coin = await this.prisma.db.token.findUnique({ where: { chain_address: { chain: 'solana', address: f.mint } }, select: { symbol: true, marketCapUsd: true, createdAt: true } });
    if (!coin) return;
    for (const c of this.byWallet.get(f.wallet) ?? []) {
      // one action per copy per coin per side per 10s (the feed can split one swap into several events)
      if (!(await this.redis.allow(`wc:${c.id}:${f.mint}:${f.side}`, 1, 10))) continue;
      const bought = !!(await this.redis.client.sismember(`wc:${c.id}:bought`, f.mint));
      const d = copyDecision(c, f, { marketCapUsd: coin.marketCapUsd, ageMin: (Date.now() - coin.createdAt.getTime()) / 60_000 }, bought);
      if (d.action === 'skip') {
        await this.prisma.db.walletCopy.update({ where: { id: c.id }, data: { skipped: { increment: 1 } } }).catch(() => undefined);
        continue;
      }
      if (d.action === 'buy') {
        await this.redis.client.multi().sadd(`wc:${c.id}:bought`, f.mint).expire(`wc:${c.id}:bought`, 7 * 86400).exec();
        await this.prisma.db.walletCopy.update({ where: { id: c.id }, data: { buys: { increment: 1 } } });
        await this.orders.executeNow({ userId: c.userId, chain: 'solana', token: f.mint, symbol: coin.symbol, kind: 'copy_buy', buyAmount: d.amount, slippageBps: c.slippageBps, tpPct: c.tpPct, slPct: c.slPct });
      } else {
        await this.prisma.db.walletCopy.update({ where: { id: c.id }, data: { sells: { increment: 1 } } });
        await this.orders.executeNow({ userId: c.userId, chain: 'solana', token: f.mint, symbol: coin.symbol, kind: 'copy_sell', sellPct: d.pct, slippageBps: c.slippageBps });
      }
    }
  }
}

import { Controller, Get, NotFoundException, Param, Query, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { Cron } from '@nestjs/schedule';
import { dexscreener, fetchNews, geckoterminal, goplus, jupiter, polymarket } from '@magura/chains';
import type { User } from '@magura/db';
import { WALLET_TAGS, parseFilter, type ChainId, type HolderSort, type Timeframe, type TokenIntel, type WalletTag } from '@magura/shared';
import { CurrentUser, OptionalUser, Public } from '../auth/auth.guard';
import { PrismaService, RedisService } from '../common/infra.module';
import { parse, zChain } from '../common/zod';
import { HuntService, type HuntSort } from './hunt.service';
import { TrenchesService } from './trenches.service';
import { CoinActivityService } from './coin-activity.service';
import { IntelService } from './intel.service';

const addr = (chain: ChainId, a: string) => (chain === 'solana' ? a : a.toLowerCase());

@Controller('market')
export class MarketController {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly trenches: TrenchesService,
    private readonly hunt: HuntService,
    private readonly activity: CoinActivityService,
    private readonly intel: IntelService,
  ) {}

  /** Hunt: discover coins. `f` = JSON CoinFilter from the Filters panel; `count=1` returns only the match count. */
  @Public()
  @Get('hunt')
  async huntList(@Query() q: Record<string, string>, @OptionalUser() user?: User) {
    const p = parse(
      z.object({
        sort: z.enum(['hot', 'gainers', 'losers', 'volume', 'new', 'm5']).default('hot'),
        f: z.string().max(4000).optional(),
        count: z.enum(['1']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      q,
    );
    const res = await this.hunt.list({ sort: p.sort as HuntSort, filter: parseFilter(p.f), limit: p.limit }, user?.id ?? null);
    return p.count ? { total: res.total } : res.items;
  }

  @Get('hunt/friends')
  huntFriends(@CurrentUser() user: User) {
    return this.hunt.friendsBuying(user.id);
  }

  @Public()
  @Get('hunt/calls')
  huntCalls() {
    return this.hunt.freshCalls();
  }

  @Public()
  @Get('ticker')
  async ticker() {
    const raw = await this.redis.client.get('majors');
    return raw ? JSON.parse(raw) : {};
  }

  @Public()
  @Get('trenches')
  async list(@Query() q: Record<string, string>, @OptionalUser() user?: User) {
    const p = parse(
      z.object({
        stage: z.enum(['new', 'almost', 'survived']).default('new'),
        f: z.string().max(4000).optional(),
        count: z.enum(['1']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40),
      }),
      q,
    );
    const res = await this.trenches.list(p.stage, parseFilter(p.f), p.limit, user?.id ?? null);
    return p.count ? { total: res.total } : res.items;
  }

  /** Token page: best pair + Magura snapshot + GoPlus risk. */
  @Public()
  @Get('tokens/:chain/:address')
  async token(@Param('chain') chainRaw: string, @Param('address') rawAddr: string) {
    const chain = parse(zChain, chainRaw);
    const address = addr(chain, rawAddr);
    const [pair, row, risk, orders] = await Promise.all([
      this.redis.cached(`pair:${chain}:${address}`, 15, () => dexscreener.bestPair(chain, address)).catch(() => null),
      this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } } }),
      this.redis.cached(`risk:${chain}:${address}`, 600, () => goplus.tokenRisk(chain, address).catch(() => null)),
      this.redis.cached(`dsorders:${chain}:${address}`, 600, () => dexscreener.orders(chain, address).catch(() => null)),
    ]);
    if (!pair && !row) throw new NotFoundException('token_not_found');
    // other coins with the same ticker — copycats or the original
    const symbol = pair?.baseToken.symbol ?? row?.symbol;
    const sameName = symbol
      ? await this.prisma.db.token.findMany({
          where: { symbol: { equals: symbol, mode: 'insensitive' }, NOT: { address } },
          orderBy: [{ marketCapUsd: { sort: 'desc', nulls: 'last' } }],
          take: 6,
          select: { chain: true, address: true, symbol: true, name: true, imageUrl: true, marketCapUsd: true, createdAt: true },
        })
      : [];
    return { chain, address, pair, token: row, risk, dex: orders, sameName };
  }

  /** Live swaps on a coin, each wallet labelled (you, Magura, following, tracked, dev). */
  @Public()
  @Get('tokens/:chain/:address/trades')
  coinTrades(@Param('chain') c: string, @Param('address') a: string, @Query('min') min = '0', @OptionalUser() user?: User) {
    const chain = parse(zChain, c);
    return this.activity.trades(chain, addr(chain, a), user?.id ?? null, Math.max(0, Number(min) || 0));
  }

  /** Top holders with labels (dev, pool, early buyer, Magura, tracked). */
  @Public()
  @Get('tokens/:chain/:address/holders')
  coinHolders(@Param('chain') c: string, @Param('address') a: string, @OptionalUser() user?: User) {
    const chain = parse(zChain, c);
    return this.activity.holders(chain, addr(chain, a), user?.id ?? null);
  }

  /**
   * Wallet table from our launch ledger: tags, entry, PnL. `sort` = holding | pnl | early | bought
   * (Holders, Top traders, Early buyers tabs). `tag` filters to one wallet type. Returns rows: null
   * for coins we didn't see launch — the web falls back to /holders.
   */
  @Public()
  @Get('tokens/:chain/:address/wallets')
  async coinWallets(@Param('chain') c: string, @Param('address') a: string, @Query('sort') sortRaw = 'holding', @Query('tag') tagRaw?: string) {
    const chain = parse(zChain, c);
    const address = addr(chain, a);
    const sort: HolderSort = (['holding', 'pnl', 'early', 'bought'] as const).includes(sortRaw as HolderSort) ? (sortRaw as HolderSort) : 'holding';
    const tag = WALLET_TAGS.some((t) => t.id === tagRaw) ? (tagRaw as WalletTag) : null;
    const [row, majors] = await Promise.all([
      this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } }, select: { priceUsd: true, marketCapUsd: true, intel: true, creator: true } }),
      this.redis.client.get('majors'),
    ]);
    const px = majors ? (JSON.parse(majors) as Record<string, number>) : {};
    const nativeUsd = chain === 'solana' ? px.SOL : chain === 'bsc' ? px.BNB : px.ETH;
    // curve coins: 1B supply → price from market cap when the pair price isn't known yet
    const priceUsd = row?.priceUsd ?? (row?.marketCapUsd ? row.marketCapUsd / 1e9 : null);
    const priceNative = priceUsd && nativeUsd ? priceUsd / nativeUsd : null;
    const rows = await this.intel.holders(chain, address, sort, tag, priceNative, 100);
    return { rows, nativeUsd: nativeUsd ?? null, intel: (row?.intel as TokenIntel | null) ?? null, creator: row?.creator ?? null };
  }

  /** Dev report card: launches, migrations, quick rugs, best coin. */
  @Public()
  @Get('dev/:chain/:creator')
  devReport(@Param('chain') c: string, @Param('creator') creator: string) {
    const chain = parse(zChain, c);
    return this.redis.cached(`devr:${chain}:${creator}`, 30, () => this.intel.devReport(chain, addr(chain, creator)));
  }

  /** Buys and sells by people you follow — chart markers. */
  @Public()
  @Get('tokens/:chain/:address/friends')
  coinFriends(@Param('chain') c: string, @Param('address') a: string, @OptionalUser() user?: User) {
    const chain = parse(zChain, c);
    return this.activity.friendTrades(chain, addr(chain, a), user?.id ?? null);
  }

  @Public()
  @Get('ohlcv/:chain/:pool')
  ohlcv(@Param('chain') chainRaw: string, @Param('pool') pool: string, @Query('tf') tfRaw = '15m') {
    const chain = parse(zChain, chainRaw);
    const tf = parse(z.enum(['1m', '5m', '15m', '1h', '4h', '1d']), tfRaw) as Timeframe;
    const ttl = tf === '1m' ? 15 : tf === '5m' ? 45 : tf === '15m' ? 90 : 180;
    return this.redis.cachedStale(`ohlcv:${chain}:${pool}:${tf}`, ttl, 6 * 3600, () => geckoterminal.ohlcv(chain, pool, tf)).catch(() => {
      throw new ServiceUnavailableException({ error: 'chart_busy', message: 'Chart data is busy, retrying' });
    });
  }

  @Public()
  @Get('search')
  async search(@Query('q') q = '') {
    if (q.trim().length < 2) return [];
    return this.redis.cached(`search:${q.toLowerCase()}`, 30, async () => {
      const [pairs, jup] = await Promise.all([
        dexscreener.search(q).catch(() => []),
        jupiter.searchTokens(q).catch(() => []),
      ]);
      const seen = new Set<string>();
      const out = pairs
        .filter((p) => {
          const k = `${p.chain}:${p.baseToken.address.toLowerCase()}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 20);
      for (const t of jup.slice(0, 10)) {
        const k = `solana:${t.id.toLowerCase()}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push({
            chain: 'solana',
            pairAddress: '',
            dex: 'jupiter',
            baseToken: { address: t.id, symbol: t.symbol, name: t.name },
            quoteToken: { address: '', symbol: '' },
            priceUsd: null,
            priceChange24h: null,
            volume24h: null,
            liquidityUsd: null,
            fdv: null,
            marketCap: null,
            pairCreatedAt: null,
            imageUrl: t.icon ?? null,
          });
        }
      }
      return out;
    });
  }

  @Public()
  @Get('news')
  news() {
    return this.prisma.db.newsItem.findMany({ orderBy: { publishedAt: 'desc' }, take: 40 });
  }

  @Public()
  @Get('predictions')
  predictions(@Query('q') q = '') {
    return this.redis.cached(`pm:${q.toLowerCase()}`, 120, () => polymarket.markets(q).catch(() => []));
  }

  @Cron('*/10 * * * *')
  async pullNews() {
    const items = await fetchNews().catch(() => []);
    for (const n of items.slice(0, 80)) {
      await this.prisma.db.newsItem
        .upsert({ where: { url: n.url }, update: {}, create: { source: n.source, title: n.title, url: n.url, publishedAt: n.publishedAt } })
        .catch(() => undefined);
    }
  }
}

import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Cron } from '@nestjs/schedule';
import { dexscreener, fetchNews, geckoterminal, goplus, jupiter, polymarket } from '@magura/chains';
import type { User } from '@magura/db';
import { parseFilter, type ChainId, type Timeframe } from '@magura/shared';
import { CurrentUser, OptionalUser, Public } from '../auth/auth.guard';
import { PrismaService, RedisService } from '../common/infra.module';
import { parse, zChain } from '../common/zod';
import { HuntService, type HuntSort } from './hunt.service';
import { TrenchesService } from './trenches.service';

const addr = (chain: ChainId, a: string) => (chain === 'solana' ? a : a.toLowerCase());

@Controller('market')
export class MarketController {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly trenches: TrenchesService,
    private readonly hunt: HuntService,
  ) {}

  /** Hunt: discover coins. `f` = JSON CoinFilter from the Filters panel; `count=1` returns only the match count. */
  @Public()
  @Get('hunt')
  async huntList(@Query() q: Record<string, string>, @OptionalUser() user?: User) {
    const p = parse(
      z.object({
        sort: z.enum(['hot', 'gainers', 'losers', 'volume', 'new']).default('hot'),
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
    const [pair, row, risk] = await Promise.all([
      this.redis.cached(`pair:${chain}:${address}`, 15, () => dexscreener.bestPair(chain, address)),
      this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } } }),
      this.redis.cached(`risk:${chain}:${address}`, 600, () => goplus.tokenRisk(chain, address).catch(() => null)),
    ]);
    if (!pair && !row) throw new NotFoundException('token_not_found');
    return { chain, address, pair, token: row, risk };
  }

  @Public()
  @Get('ohlcv/:chain/:pool')
  ohlcv(@Param('chain') chainRaw: string, @Param('pool') pool: string, @Query('tf') tfRaw = '15m') {
    const chain = parse(zChain, chainRaw);
    const tf = parse(z.enum(['1m', '5m', '15m', '1h', '4h', '1d']), tfRaw) as Timeframe;
    const ttl = tf === '1m' ? 10 : tf === '5m' ? 30 : 60;
    return this.redis.cached(`ohlcv:${chain}:${pool}:${tf}`, ttl, () => geckoterminal.ohlcv(chain, pool, tf));
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

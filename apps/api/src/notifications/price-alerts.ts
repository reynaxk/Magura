import { BadRequestException, Body, Controller, Delete, Get, Injectable, Logger, Param, Post, Query } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { z } from 'zod';
import { dexscreener } from '@magura/chains';
import type { PriceAlert, User } from '@magura/db';
import { fmtPrice, fmtUsd, type ChainId } from '@magura/shared';
import { CurrentUser } from '../auth/auth.guard';
import { PrismaService, RedisService } from '../common/infra.module';
import { parse, zChain } from '../common/zod';
import { NotificationsService } from './notifications.module';
import { alertHit } from './price-alerts.rules';

const MAX_ACTIVE = 30;

@Injectable()
export class PriceAlertsService {
  private readonly log = new Logger('price-alerts');
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notify: NotificationsService,
  ) {}

  async market(chain: ChainId, token: string) {
    const [pair, row] = await Promise.all([
      this.redis.cached(`pair:${chain}:${token}`, 10, () => dexscreener.bestPair(chain, token)).catch(() => null),
      this.prisma.db.token.findUnique({ where: { chain_address: { chain, address: token } } }),
    ]);
    return { price: pair?.priceUsd ?? row?.priceUsd ?? null, mc: pair?.marketCap ?? pair?.fdv ?? row?.marketCapUsd ?? null };
  }

  @Interval(20_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const alerts = await this.prisma.db.priceAlert.findMany({ where: { status: 'active' }, take: 5000 });
      const byToken = new Map<string, PriceAlert[]>();
      for (const a of alerts) byToken.set(`${a.chain}:${a.tokenAddress}`, [...(byToken.get(`${a.chain}:${a.tokenAddress}`) ?? []), a]);
      for (const [k, group] of byToken) {
        const [chain, token] = k.split(':') as [ChainId, string];
        const m = await this.market(chain, token);
        for (const a of group) {
          if (!alertHit(a, m.price, m.mc)) continue;
          const claimed = await this.prisma.db.priceAlert.updateMany({ where: { id: a.id, status: 'active' }, data: { status: 'fired', firedAt: new Date() } });
          if (!claimed.count) continue;
          const now = a.metric === 'mc' ? `MC ${fmtUsd(m.mc)}` : `$${fmtPrice(m.price)}`;
          const target = a.metric === 'mc' ? fmtUsd(a.value) : `$${fmtPrice(a.value)}`;
          await this.notify.notify(a.userId, 'price', `${a.tokenSymbol} is ${a.direction} ${target}`, `Now ${now}`, `/t/${chain}/${token}`);
        }
      }
    } catch (e) {
      this.log.warn(`tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

@Controller('alerts')
export class PriceAlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: PriceAlertsService,
  ) {}

  @Get()
  list(@Query() q: Record<string, string>, @CurrentUser() user: User) {
    const p = parse(z.object({ chain: zChain.optional(), token: z.string().optional() }), q);
    return this.prisma.db.priceAlert.findMany({
      where: { userId: user.id, status: 'active', ...(p.chain && p.token ? { chain: p.chain, tokenAddress: p.chain === 'solana' ? p.token : p.token.toLowerCase() } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(
      z.object({ chain: zChain, tokenAddress: z.string().min(20).max(80), tokenSymbol: z.string().min(1).max(20), metric: z.enum(['price', 'mc']), value: z.number().positive().max(1e13) }),
      body,
    );
    const token = b.chain === 'solana' ? b.tokenAddress : b.tokenAddress.toLowerCase();
    if ((await this.prisma.db.priceAlert.count({ where: { userId: user.id, status: 'active' } })) >= MAX_ACTIVE)
      throw new BadRequestException({ error: 'too_many_alerts', message: `Up to ${MAX_ACTIVE} active alerts` });
    const m = await this.svc.market(b.chain, token);
    const now = b.metric === 'mc' ? m.mc : m.price;
    if (now == null) throw new BadRequestException({ error: 'no_price', message: 'No live price for this coin yet' });
    return this.prisma.db.priceAlert.create({
      data: { userId: user.id, chain: b.chain, tokenAddress: token, tokenSymbol: b.tokenSymbol, metric: b.metric, value: b.value, direction: b.value >= now ? 'above' : 'below' },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: User) {
    await this.prisma.db.priceAlert.updateMany({ where: { id, userId: user.id, status: 'active' }, data: { status: 'cancelled' } });
    return { ok: true };
  }
}

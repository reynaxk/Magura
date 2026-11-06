import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { User } from '@magura/db';
import { CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/infra.module';
import { parse, zChain } from '../common/zod';

const norm = (chain: string, a: string) => (chain === 'solana' ? a : a.toLowerCase());

/** Starred coins. */
@Controller('me/watchlist')
export class WatchlistController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: User) {
    const items = await this.prisma.db.watchItem.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    if (!items.length) return [];
    const tokens = await this.prisma.db.token.findMany({
      where: { OR: items.map((i) => ({ chain: i.chain, address: i.address })) },
      select: { chain: true, address: true, symbol: true, name: true, imageUrl: true, marketCapUsd: true, priceChange1h: true, priceChange24h: true, createdAt: true },
    });
    const by = new Map(tokens.map((t) => [`${t.chain}:${t.address}`, t]));
    return items.map((i) => ({ chain: i.chain, address: i.address, token: by.get(`${i.chain}:${i.address}`) ?? null }));
  }

  @Post(':chain/:address')
  async add(@Param('chain') c: string, @Param('address') a: string, @CurrentUser() user: User) {
    const chain = parse(zChain, c);
    await this.prisma.db.watchItem.upsert({ where: { userId_chain_address: { userId: user.id, chain, address: norm(chain, a) } }, update: {}, create: { userId: user.id, chain, address: norm(chain, a) } });
    return { ok: true };
  }

  @Delete(':chain/:address')
  async remove(@Param('chain') c: string, @Param('address') a: string, @CurrentUser() user: User) {
    const chain = parse(zChain, c);
    await this.prisma.db.watchItem.deleteMany({ where: { userId: user.id, chain, address: norm(chain, a) } });
    return { ok: true };
  }
}

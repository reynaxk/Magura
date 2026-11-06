import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@magura/db';
import { CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/infra.module';
import { parse } from '../common/zod';
import { WalletCopyService } from './wallet-copy.service';

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const zCopy = z.object({
  wallet: z.string().trim().regex(SOL, 'invalid_wallet'),
  label: z.string().trim().min(1).max(24),
  buyMode: z.enum(['fixed', 'ratio']).default('fixed'),
  buyAmount: z.string().regex(/^\d+(\.\d+)?$/),
  ratioPct: z.number().int().min(1).max(1000).optional(),
  sellMode: z.enum(['copy', 'none']).default('copy'),
  minMcUsd: z.number().positive().optional(),
  maxMcUsd: z.number().positive().optional(),
  maxAgeMin: z.number().int().min(1).max(100_000).optional(),
  buyOnce: z.boolean().default(true),
  skipAddOn: z.boolean().default(true),
  blacklist: z.array(z.string().regex(SOL)).max(100).default([]),
  tpPct: z.number().min(1).max(10_000).optional(),
  slPct: z.number().min(1).max(99).optional(),
  slippageBps: z.number().int().min(50).max(5000).default(2500),
});

/** Copy any wallet (GMGN WalletCopy). */
@Controller('copy/wallets')
export class WalletCopyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: WalletCopyService,
  ) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.prisma.db.walletCopy.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(zCopy, body);
    if (Number(b.buyAmount) <= 0 || Number(b.buyAmount) > 100) return { error: 'invalid_amount' };
    const count = await this.prisma.db.walletCopy.count({ where: { userId: user.id } });
    if (count >= 20) return { error: 'max_20_copies' };
    const row = await this.prisma.db.walletCopy.upsert({
      where: { userId_chain_wallet: { userId: user.id, chain: 'solana', wallet: b.wallet } },
      update: { ...b, status: 'active' },
      create: { ...b, userId: user.id, chain: 'solana' },
    });
    await this.svc.refresh();
    return row;
  }

  @Patch(':id')
  async status(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: User) {
    const { status } = parse(z.object({ status: z.enum(['active', 'paused']) }), body);
    await this.prisma.db.walletCopy.updateMany({ where: { id, userId: user.id }, data: { status } });
    await this.svc.refresh();
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: User) {
    await this.prisma.db.walletCopy.deleteMany({ where: { id, userId: user.id } });
    await this.svc.refresh();
    return { ok: true };
  }
}

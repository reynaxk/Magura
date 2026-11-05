import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@magura/db';
import { CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/infra.module';
import { parse } from '../common/zod';

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[a-fA-F0-9]{40}$/;

/** Wallet tracker: watch any on-chain wallet and see it labelled across Magura. */
@Controller('me/tracked')
export class TrackedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.prisma.db.trackedWallet.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
  }

  @Post()
  async add(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ address: z.string().trim(), label: z.string().trim().min(1).max(24), alerts: z.boolean().optional() }), body);
    const chainKind = SOL.test(b.address) ? 'svm' : EVM.test(b.address) ? 'evm' : null;
    if (!chainKind) return { error: 'invalid_address' };
    const address = chainKind === 'evm' ? b.address.toLowerCase() : b.address;
    const count = await this.prisma.db.trackedWallet.count({ where: { userId: user.id } });
    if (count >= 200) return { error: 'limit_200' };
    return this.prisma.db.trackedWallet.upsert({
      where: { userId_chainKind_address: { userId: user.id, chainKind, address } },
      update: { label: b.label, alerts: b.alerts ?? true },
      create: { userId: user.id, chainKind, address, label: b.label, alerts: b.alerts ?? true },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: User) {
    await this.prisma.db.trackedWallet.deleteMany({ where: { id, userId: user.id } });
    return { ok: true };
  }
}

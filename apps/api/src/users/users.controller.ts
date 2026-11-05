import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@magura/db';
import { CurrentUser, OptionalUser, Public } from '../auth/auth.guard';
import { PrismaService } from '../common/infra.module';
import { parse, zHandle } from '../common/zod';
import { ModerationService } from '../moderation/moderation.service';

const publicUser = { id: true, handle: true, displayName: true, bio: true, avatarUrl: true, badges: true, createdAt: true } as const;

@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: User) {
    const [wallets, settings, counts] = await Promise.all([
      this.prisma.db.wallet.findMany({ where: { userId: user.id } }),
      this.prisma.db.userSettings.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } }),
      this.counts(user.id),
    ]);
    return { ...user, wallets, settings, ...counts };
  }

  /** Onboarding + profile edits. */
  @Patch('me')
  async update(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(
      z.object({
        handle: zHandle.optional(),
        displayName: z.string().max(40).optional(),
        bio: z.string().max(280).optional(),
        avatarUrl: z.string().url().optional(),
        experience: z.enum(['new', 'some', 'pro']).optional(),
        interests: z.array(z.string().max(30)).max(12).optional(),
      }),
      body,
    );
    if (b.avatarUrl) await this.moderation.assertImageSafe(b.avatarUrl);
    if (b.handle) b.handle = b.handle.toLowerCase();
    return this.prisma.db.user.update({ where: { id: user.id }, data: b });
  }

  @Patch('me/settings')
  async settings(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(
      z
        .object({
          publicPnl: z.boolean(),
          showHoldings: z.boolean(),
          copyable: z.boolean(),
          dmsFromAnyone: z.boolean(),
          showInWorld: z.boolean(),
          readReceipts: z.boolean(),
          autoJoinVoice: z.boolean(),
          hideBalanceOnStream: z.boolean(),
          quickBuyAmounts: z.record(z.string(), z.string().regex(/^\d+(\.\d+)?$/)),
          slippageBps: z.number().int().min(10).max(5000),
          tradePresets: z
            .array(
              z.object({
                name: z.string().min(1).max(12),
                slippageBps: z.number().int().min(10).max(5000),
                buy: z.record(z.string(), z.array(z.string().regex(/^\d+(\.\d+)?$/)).length(4)),
                sell: z.array(z.number().int().min(1).max(100)).length(4),
              }),
            )
            .length(3),
          activePreset: z.number().int().min(0).max(2),
          copyBudgetUsd: z.number().min(0),
          copyMaxPerBuyUsd: z.number().min(1),
          copyStopLossPct: z.number().int().min(1).max(100),
          copySells: z.boolean(),
          copyMemecoins: z.boolean(),
          copyBuyExisting: z.boolean(),
          copyConfirmAboveUsd: z.number().min(0),
          notifications: z.record(z.string(), z.object({ push: z.boolean(), app: z.boolean() })),
        })
        .partial(),
      body,
    );
    return this.prisma.db.userSettings.upsert({ where: { userId: user.id }, update: b, create: { userId: user.id, ...b } });
  }

  @Post('me/wallets')
  async addWallet(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(
      z.object({ chainKind: z.enum(['svm', 'evm']), address: z.string().min(32).max(64), label: z.string().max(30).optional(), privyWalletId: z.string().optional(), delegated: z.boolean().optional() }),
      body,
    );
    const address = b.chainKind === 'evm' ? b.address.toLowerCase() : b.address;
    const existing = await this.prisma.db.wallet.count({ where: { userId: user.id } });
    return this.prisma.db.wallet.upsert({
      where: { chainKind_address: { chainKind: b.chainKind, address } },
      update: { userId: user.id, label: b.label, privyWalletId: b.privyWalletId, delegated: b.delegated ?? false },
      create: { ...b, address, userId: user.id, isPrimary: existing === 0 },
    });
  }

  @Public()
  @Get('users/:handle')
  async profile(@Param('handle') handle: string, @OptionalUser() viewer?: User) {
    const u = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() }, select: { ...publicUser, settings: true } });
    if (!u) throw new NotFoundException('user_not_found');
    const { settings, ...rest } = u;
    const [counts, isFollowing, copying] = await Promise.all([
      this.counts(u.id),
      viewer ? this.prisma.db.follow.findUnique({ where: { followerId_followingId: { followerId: viewer.id, followingId: u.id } } }) : null,
      viewer ? this.prisma.db.copySubscription.findUnique({ where: { leaderId_copierId: { leaderId: u.id, copierId: viewer.id } } }) : null,
    ]);
    return {
      ...rest,
      ...counts,
      copyable: settings?.copyable ?? true,
      publicPnl: settings?.publicPnl ?? true,
      isFollowing: !!isFollowing,
      copyStatus: copying?.status ?? null,
    };
  }

  @Public()
  @Get('users/:handle/trades')
  async trades(@Param('handle') handle: string) {
    const u = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() }, include: { settings: true } });
    if (!u) throw new NotFoundException('user_not_found');
    if (u.settings && !u.settings.publicPnl) return [];
    return this.prisma.db.trade.findMany({
      where: { userId: u.id, status: 'confirmed' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, chain: true, side: true, tokenAddress: true, tokenSymbol: true, amountUsd: true, priceUsd: true, txHash: true, createdAt: true },
    });
  }

  @Post('users/:handle/follow')
  async follow(@Param('handle') handle: string, @CurrentUser() user: User) {
    const target = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() } });
    if (!target || target.id === user.id) throw new NotFoundException('user_not_found');
    await this.prisma.db.follow.upsert({
      where: { followerId_followingId: { followerId: user.id, followingId: target.id } },
      update: {},
      create: { followerId: user.id, followingId: target.id },
    });
    return { ok: true };
  }

  @Delete('users/:handle/follow')
  async unfollow(@Param('handle') handle: string, @CurrentUser() user: User) {
    const target = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() } });
    if (target) await this.prisma.db.follow.deleteMany({ where: { followerId: user.id, followingId: target.id } });
    return { ok: true };
  }

  @Public()
  @Get('users')
  search(@Query('q') q?: string) {
    return this.prisma.db.user.findMany({
      where: q ? { OR: [{ handle: { contains: q.toLowerCase() } }, { displayName: { contains: q, mode: 'insensitive' } }] } : {},
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: publicUser,
    });
  }

  private async counts(userId: string) {
    const [followers, following, copiers] = await Promise.all([
      this.prisma.db.follow.count({ where: { followingId: userId } }),
      this.prisma.db.follow.count({ where: { followerId: userId } }),
      this.prisma.db.copySubscription.count({ where: { leaderId: userId, status: 'active' } }),
    ]);
    return { followers, following, copiers };
  }
}

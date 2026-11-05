import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Trade, User } from '@magura/db';
import { CHAINS, REFERRAL, cashbackTierFor, type ChainId } from '@magura/shared';
import { PrismaService, RedisService } from '../common/infra.module';
import { NotificationsService } from '../notifications/notifications.module';
import { TradingService } from '../trading/trading.service';

const DAY = 86_400_000;

/** Invite links, fee discounts for invitees and a fee share for inviters. */
@Injectable()
export class ReferralsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly trading: TradingService,
    private readonly notify: NotificationsService,
  ) {}

  onModuleInit() {
    this.trading.onConfirmed((t) => this.accrue(t));
    this.trading.setDiscountLookup((userId) => this.isInvitee(userId));
  }

  /** Cached "was this user invited?" — used on every quote. */
  async isInvitee(userId: string): Promise<boolean> {
    const k = `ref:invitee:${userId}`;
    const hit = await this.redis.client.get(k);
    if (hit != null) return hit === '1';
    const r = await this.prisma.db.referral.findUnique({ where: { inviteeId: userId } });
    await this.redis.client.set(k, r ? '1' : '0', 'EX', 3600);
    return !!r;
  }

  async inviterFor(code: string) {
    const u = await this.prisma.db.user.findUnique({ where: { handle: code.toLowerCase() }, select: { id: true, handle: true, displayName: true, avatarUrl: true } });
    if (!u) throw new NotFoundException('invite_not_found');
    return u;
  }

  /** Link a new account to the person who invited it. Only within the first days, once, never yourself. */
  async attach(user: User, code: string) {
    const inviter = await this.inviterFor(code);
    if (inviter.id === user.id) throw new BadRequestException('self_invite');
    if (Date.now() - user.createdAt.getTime() > REFERRAL.attachWindowDays * DAY) throw new BadRequestException('too_late');
    const existing = await this.prisma.db.referral.findUnique({ where: { inviteeId: user.id } });
    if (existing) return { ok: true, inviter: inviter.handle, already: true };
    // no loops: the inviter can't be someone you invited
    const loop = await this.prisma.db.referral.findUnique({ where: { inviteeId: inviter.id } });
    if (loop?.inviterId === user.id) throw new BadRequestException('invite_loop');
    await this.prisma.db.referral.create({ data: { inviteeId: user.id, inviterId: inviter.id } });
    await this.redis.client.set(`ref:invitee:${user.id}`, '1', 'EX', 3600);
    await this.notify.notify(inviter.id, 'group', `@${user.handle} joined with your link`, 'You earn 25% of the fees they pay', '/rewards');
    return { ok: true, inviter: inviter.handle };
  }

  /** 30-day confirmed trading volume — sets the cashback tier. */
  async volume30d(userId: string): Promise<number> {
    const r = await this.prisma.db.trade.aggregate({
      where: { userId, status: 'confirmed', createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
      _sum: { amountUsd: true },
    });
    return Number(r._sum.amountUsd ?? 0);
  }

  private async accrue(t: Trade) {
    const fee = Number(t.feeUsd ?? 0);
    if (fee <= 0) return;
    // cashback for the trader
    const { tier } = cashbackTierFor(await this.volume30d(t.userId));
    if (tier.pct > 0) {
      await this.prisma.db.rewardEntry
        .create({ data: { userId: t.userId, kind: 'cashback', inviteeId: t.userId, tradeId: `cb:${t.id}`, chain: t.chain, feeUsd: fee, rewardUsd: (fee * tier.pct) / 100 } })
        .catch(() => undefined); // unique tradeId → already counted
    }
    // fee share for whoever invited them
    const ref = await this.prisma.db.referral.findUnique({ where: { inviteeId: t.userId } });
    if (!ref) return;
    await this.prisma.db.rewardEntry
      .create({ data: { userId: ref.inviterId, kind: 'referral', inviteeId: t.userId, tradeId: t.id, chain: t.chain, feeUsd: fee, rewardUsd: fee * REFERRAL.inviterShare } })
      .catch(() => undefined);
  }

  async summary(user: User) {
    const [invites, earned, claims, recent] = await Promise.all([
      this.prisma.db.referral.findMany({
        where: { inviterId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { invitee: { select: { handle: true, avatarUrl: true } } },
      }),
      this.prisma.db.rewardEntry.groupBy({ by: ['inviteeId'], where: { userId: user.id, kind: 'referral' }, _sum: { rewardUsd: true, feeUsd: true }, _count: true }),
      this.prisma.db.rewardClaim.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.db.rewardEntry.aggregate({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 7 * DAY) } }, _sum: { rewardUsd: true } }),
    ]);
    const byInvitee = new Map(earned.map((e) => [e.inviteeId, e]));
    const referralEarned = earned.reduce((s, e) => s + Number(e._sum.rewardUsd ?? 0), 0);
    const [cash, volume] = await Promise.all([
      this.prisma.db.rewardEntry.aggregate({ where: { userId: user.id, kind: 'cashback' }, _sum: { rewardUsd: true } }),
      this.volume30d(user.id),
    ]);
    const cashbackEarned = Number(cash._sum.rewardUsd ?? 0);
    const totalEarned = referralEarned + cashbackEarned;
    const { tier, next } = cashbackTierFor(volume);
    const claimed = claims.filter((c) => c.status !== 'rejected').reduce((s, c) => s + Number(c.amountUsd), 0);
    const invited = await this.isInvitee(user.id);
    return {
      code: user.handle,
      invitedBy: invited ? (await this.prisma.db.referral.findUnique({ where: { inviteeId: user.id }, include: { inviter: { select: { handle: true } } } }))?.inviter.handle ?? null : null,
      cashback: { tier, next, volume30dUsd: volume, earnedUsd: cashbackEarned },
      totals: {
        referralUsd: referralEarned,
        invites: invites.length,
        trading: earned.filter((e) => e._count > 0).length,
        earnedUsd: totalEarned,
        last7dUsd: Number(recent._sum.rewardUsd ?? 0),
        claimableUsd: Math.max(0, totalEarned - claimed),
        minClaimUsd: REFERRAL.minClaimUsd,
      },
      invites: invites.map((i) => ({
        handle: i.invitee.handle,
        avatarUrl: i.invitee.avatarUrl,
        joinedAt: i.createdAt,
        trades: byInvitee.get(i.inviteeId)?._count ?? 0,
        earnedUsd: Number(byInvitee.get(i.inviteeId)?._sum.rewardUsd ?? 0),
      })),
      claims: claims.map((c) => ({ id: c.id, amountUsd: Number(c.amountUsd), status: c.status, chain: c.chain, txHash: c.txHash, createdAt: c.createdAt })),
    };
  }

  /** Request a payout of everything claimable to one of your wallets. Paid by the team from the fee wallet. */
  async claim(user: User, chain: ChainId) {
    const s = await this.summary(user);
    if (s.totals.claimableUsd < REFERRAL.minClaimUsd) throw new BadRequestException({ error: 'below_minimum', message: `You can claim from $${REFERRAL.minClaimUsd}` });
    const open = await this.prisma.db.rewardClaim.count({ where: { userId: user.id, status: 'requested' } });
    if (open) throw new BadRequestException({ error: 'claim_pending', message: 'Your last claim is still being paid' });
    const wallet = await this.prisma.db.wallet.findFirst({ where: { userId: user.id, chainKind: CHAINS[chain].kind }, orderBy: { isPrimary: 'desc' } });
    if (!wallet) throw new BadRequestException({ error: 'no_wallet', message: `Connect a ${CHAINS[chain].name} wallet first` });
    return this.prisma.db.rewardClaim.create({ data: { userId: user.id, amountUsd: Math.floor(s.totals.claimableUsd * 100) / 100, wallet: wallet.address, chain } });
  }
}

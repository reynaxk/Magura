import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { dexscreener, tokenDecimals } from '@magura/chains';
import type { User } from '@magura/db';
import type { ChainId } from '@magura/shared';
import { CurrentUser, OptionalUser, Public } from '../auth/auth.guard';
import { PrismaService, RedisService } from '../common/infra.module';
import { parse, zChain } from '../common/zod';
import { computePnl } from '../trading/pnl';
import { ReferralsService } from './referrals.service';

@Controller()
export class ReferralsController {
  constructor(
    private readonly refs: ReferralsService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Invite landing page: who invited you. */
  @Public()
  @Get('invite/:code')
  invite(@Param('code') code: string) {
    return this.refs.inviterFor(code);
  }

  @Post('me/referral')
  attach(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ code: z.string().min(2).max(20) }), body);
    return this.refs.attach(user, b.code);
  }

  @Get('me/rewards')
  rewards(@CurrentUser() user: User) {
    return this.refs.summary(user);
  }

  @Post('me/rewards/claim')
  claim(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ chain: zChain }), body);
    return this.refs.claim(user, b.chain);
  }

  /** Data for a shareable PnL card on one coin. Public when the trader shows their PnL. */
  @Public()
  @Get('cards/pnl/:handle/:chain/:token')
  async pnlCard(@Param('handle') handle: string, @Param('chain') c: string, @Param('token') t: string, @OptionalUser() viewer?: User) {
    const chain = parse(zChain, c) as ChainId;
    const token = chain === 'solana' ? t : t.toLowerCase();
    const u = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() }, include: { settings: true } });
    if (!u) throw new NotFoundException();
    if (u.settings && !u.settings.publicPnl && viewer?.id !== u.id) throw new ForbiddenException('private');
    const trades = await this.prisma.db.trade.findMany({ where: { userId: u.id, chain, tokenAddress: token, status: 'confirmed' }, orderBy: { createdAt: 'asc' } });
    if (!trades.length) throw new NotFoundException('no_trades');
    const key = `${chain}:${token}`;
    const p = computePnl(trades.map((x) => ({ tokenKey: key, side: x.side as 'buy' | 'sell', amountIn: x.amountIn, amountOut: x.amountOut, amountUsd: Number(x.amountUsd ?? 0) })));
    const investedUsd = trades.filter((x) => x.side === 'buy').reduce((s, x) => s + Number(x.amountUsd ?? 0), 0);
    const returnedUsd = trades.filter((x) => x.side === 'sell').reduce((s, x) => s + Number(x.amountUsd ?? 0), 0);

    // still holding something → value it at today's price
    let openValueUsd = 0;
    const open = p.openPositions[0];
    if (open) {
      const [pair, dec] = await Promise.all([
        this.redis.cached(`pair:${chain}:${token}`, 15, () => dexscreener.bestPair(chain, token)).catch(() => null),
        this.redis.cached(`dec:${chain}:${token}`, 86_400, () => tokenDecimals(chain, token)).catch(() => null),
      ]);
      const price = pair?.priceUsd ?? (await this.prisma.db.token.findUnique({ where: { chain_address: { chain, address: token } } }))?.priceUsd ?? null;
      if (price != null && dec != null) openValueUsd = (Number(open.qty) / 10 ** dec) * price;
    }
    const pnlUsd = returnedUsd + openValueUsd - investedUsd;
    const first = trades[0].createdAt;
    const last = open ? new Date() : trades[trades.length - 1].createdAt;
    return {
      handle: u.handle,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      chain,
      token,
      symbol: trades[trades.length - 1].tokenSymbol,
      investedUsd,
      returnedUsd,
      openValueUsd,
      pnlUsd,
      pnlPct: investedUsd > 0 ? (pnlUsd / investedUsd) * 100 : null,
      holding: !!open,
      heldMs: last.getTime() - first.getTime(),
    };
  }
}

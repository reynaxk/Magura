import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import type { User } from '@magura/db';
import { CHAINS } from '@magura/shared';
import { CurrentUser, Public } from '../auth/auth.guard';
import { env } from '../config';
import { PrismaService } from '../common/infra.module';
import { parse } from '../common/zod';

const NETWORK = { solana: { network: 'solana', asset: 'SOL' }, base: { network: 'base', asset: 'ETH' }, ethereum: { network: 'ethereum', asset: 'ETH' } } as const;
const enabled = () => !!(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);

/** Card / Apple Pay funding through Coinbase Onramp, straight into the user's own wallet. */
@Controller('onramp')
export class OnrampController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('status')
  status() {
    return { available: enabled(), chains: Object.keys(NETWORK) };
  }

  @Post('session')
  async session(@Body() body: unknown, @CurrentUser() user: User, @Req() req: Request) {
    if (!enabled()) throw new BadRequestException({ error: 'onramp_unavailable', message: 'Card funding is not switched on yet' });
    const b = parse(z.object({ chain: z.enum(['solana', 'base', 'ethereum']), amountUsd: z.number().min(5).max(5000).optional() }), body);
    const wallet = await this.prisma.db.wallet.findFirst({ where: { userId: user.id, chainKind: CHAINS[b.chain].kind }, orderBy: { isPrimary: 'desc' } });
    if (!wallet) throw new BadRequestException({ error: 'no_wallet', message: `Connect a ${CHAINS[b.chain].name} wallet first` });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generateJwt } = require('@coinbase/cdp-sdk/auth') as { generateJwt: (o: Record<string, string>) => Promise<string> };
    const jwt = await generateJwt({
      apiKeyId: env.CDP_API_KEY_ID!,
      apiKeySecret: env.CDP_API_KEY_SECRET!,
      requestMethod: 'POST',
      requestHost: 'api.developer.coinbase.com',
      requestPath: '/onramp/v1/token',
    });
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const n = NETWORK[b.chain];
    const res = await fetch('https://api.developer.coinbase.com/onramp/v1/token', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ addresses: [{ address: wallet.address, blockchains: [n.network] }], assets: [n.asset], ...(ip ? { clientIp: ip } : {}) }),
    });
    if (!res.ok) throw new BadRequestException({ error: 'onramp_failed', message: `Coinbase said ${res.status}` });
    const { token } = (await res.json()) as { token: string };
    const q = new URLSearchParams({
      sessionToken: token,
      defaultNetwork: n.network,
      defaultAsset: n.asset,
      presetFiatAmount: String(b.amountUsd ?? 50),
      fiatCurrency: 'USD',
      partnerUserRef: user.id.slice(0, 50),
      redirectUrl: `${env.WEB_ORIGIN.split(',')[0]}/portfolio?funded=1`,
    });
    return { url: `https://pay.coinbase.com/buy/select-asset?${q}` };
  }
}

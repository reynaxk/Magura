import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrivyClient } from '@privy-io/server-auth';
import type { User } from '@magura/db';
import { devAuthEnabled, env } from '../config';
import { PrismaService } from '../common/infra.module';

@Injectable()
export class AuthService {
  readonly privy: PrivyClient | null =
    env.PRIVY_APP_ID && env.PRIVY_APP_SECRET
      ? new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET, {
          walletApi: env.PRIVY_AUTHORIZATION_PRIVATE_KEY
            ? { authorizationPrivateKey: env.PRIVY_AUTHORIZATION_PRIVATE_KEY }
            : undefined,
        })
      : null;

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve a Magura user from a Privy access token (or dev header locally). */
  async userFromToken(token: string | undefined, devHandle?: string): Promise<User> {
    if (devAuthEnabled && devHandle) return this.upsertDevUser(devHandle);
    if (!token) throw new UnauthorizedException('missing_token');
    if (!this.privy) throw new UnauthorizedException('privy_not_configured');
    let privyId: string;
    try {
      privyId = (await this.privy.verifyAuthToken(token)).userId;
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
    const existing = await this.prisma.db.user.findUnique({ where: { privyId } });
    if (existing) return existing;
    return this.createFromPrivy(privyId);
  }

  private async createFromPrivy(privyId: string): Promise<User> {
    const pu = await this.privy!.getUserById(privyId);
    const email = pu.email?.address ?? null;
    const base = (email?.split('@')[0] ?? `trader${Math.floor(Math.random() * 1e6)}`).replace(/[^a-z0-9_.]/gi, '').slice(0, 16) || 'trader';
    const handle = await this.uniqueHandle(base.toLowerCase());
    const wallets = (pu.linkedAccounts as any[])
      .filter((a) => a.type === 'wallet')
      .map((w, i) => ({
        chainKind: w.chainType === 'solana' ? 'svm' : 'evm',
        address: w.chainType === 'solana' ? w.address : String(w.address).toLowerCase(),
        isPrimary: i === 0,
        privyWalletId: w.id ?? null,
        delegated: !!w.delegated,
        label: w.walletClientType ?? null,
      }));
    return this.prisma.db.user.create({
      data: { privyId, handle, email, settings: { create: {} }, wallets: { create: wallets } },
    });
  }

  private async uniqueHandle(base: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const h = i === 0 ? base : `${base}${Math.floor(Math.random() * 9999)}`;
      if (!(await this.prisma.db.user.findUnique({ where: { handle: h } }))) return h;
    }
    return `${base}${Date.now().toString(36)}`;
  }

  private upsertDevUser(handle: string): Promise<User> {
    const h = handle.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20) || 'dev';
    return this.prisma.db.user.upsert({
      where: { privyId: `dev:${h}` },
      update: {},
      create: { privyId: `dev:${h}`, handle: h, displayName: h, settings: { create: {} } },
    });
  }
}

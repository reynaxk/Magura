import { Body, Controller, Get, Global, Injectable, Module, Param, Post } from '@nestjs/common';
import webpush from 'web-push';
import { z } from 'zod';
import type { User } from '@magura/db';
import { CurrentUser, Public } from '../auth/auth.guard';
import { env } from '../config';
import { PrismaService } from '../common/infra.module';
import { parse } from '../common/zod';
import { RealtimeService } from '../realtime/realtime.service';

export type NotifyKind = 'copy' | 'call' | 'dm' | 'live' | 'price' | 'group';

const pushEnabled = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rt: RealtimeService,
  ) {}

  /** Respects each user's per-event push / in-app preferences from Settings. */
  async notify(userId: string, kind: NotifyKind, title: string, body: string, href: string | null = null) {
    const s = await this.prisma.db.userSettings.findUnique({ where: { userId }, select: { notifications: true } });
    const pref = ((s?.notifications ?? {}) as Record<string, { push?: boolean; app?: boolean }>)[kind] ?? { push: true, app: true };
    if (pref.app !== false) {
      const n = await this.prisma.db.notification.create({ data: { userId, kind, title, body, href } });
      this.rt.toUser(userId, 'notification', { id: n.id, kind, title, body, href });
    }
    if (pref.push && pushEnabled) {
      const subs = await this.prisma.db.pushSubscription.findMany({ where: { userId } });
      await Promise.all(
        subs.map((sub) =>
          webpush
            .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title, body, href }))
            .catch(async (e: { statusCode?: number }) => {
              if (e.statusCode === 404 || e.statusCode === 410) await this.prisma.db.pushSubscription.delete({ where: { id: sub.id } });
            }),
        ),
      );
    }
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.prisma.db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: User) {
    await this.prisma.db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post(':id/read')
  async read(@Param('id') id: string, @CurrentUser() user: User) {
    await this.prisma.db.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Public()
  @Get('vapid')
  vapid() {
    return { publicKey: env.VAPID_PUBLIC_KEY ?? null };
  }

  @Post('push-subscriptions')
  async subscribe(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }), body);
    await this.prisma.db.pushSubscription.upsert({
      where: { endpoint: b.endpoint },
      update: { userId: user.id, p256dh: b.keys.p256dh, auth: b.keys.auth },
      create: { userId: user.id, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth },
    });
    return { ok: true };
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}

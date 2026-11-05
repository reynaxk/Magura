import { Body, Controller, Get, Global, Injectable, Module, OnModuleInit, Param, Post } from '@nestjs/common';
import webpush from 'web-push';
import { z } from 'zod';
import type { User } from '@magura/db';
import { CurrentUser, Public } from '../auth/auth.guard';
import { env } from '../config';
import { PrismaService } from '../common/infra.module';
import { parse } from '../common/zod';
import { RealtimeService } from '../realtime/realtime.service';

export type NotifyKind = 'copy' | 'call' | 'dm' | 'live' | 'price' | 'group' | 'order' | 'alert';

/** VAPID keys: from env if set, otherwise generated once and kept in the database. */
const vapid: { publicKey: string | null } = { publicKey: null };
let pushEnabled = false;
async function initVapid(prisma: PrismaService) {
  if (pushEnabled) return;
  let pub = env.VAPID_PUBLIC_KEY;
  let priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const row = await prisma.db.appKey.findUnique({ where: { name: 'vapid' } });
    if (row) ({ publicKey: pub, privateKey: priv } = JSON.parse(row.value));
    else {
      const k = webpush.generateVAPIDKeys();
      await prisma.db.appKey.create({ data: { name: 'vapid', value: JSON.stringify(k) } }).catch(async () => {
        // another replica won the race — use theirs
        const r = await prisma.db.appKey.findUniqueOrThrow({ where: { name: 'vapid' } });
        Object.assign(k, JSON.parse(r.value));
      });
      pub = k.publicKey;
      priv = k.privateKey;
    }
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, pub!, priv!);
  vapid.publicKey = pub!;
  pushEnabled = true;
}

/** Send one alert to a linked Telegram chat. */
export async function sendTelegram(chatId: string, title: string, body: string, href: string | null, code?: string | null) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const url = href ? (href.startsWith('http') ? href : `${env.WEB_ORIGIN.split(',')[0]}${href}`) : null;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `<b>${esc(title)}</b>\n${esc(body)}${code ? `\n\n<i>Your Magura code: ${esc(code)}</i>` : ''}`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(url ? { reply_markup: { inline_keyboard: [[{ text: 'Open in Magura', url }]] } } : {}),
    }),
  });
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rt: RealtimeService,
  ) {}

  async onModuleInit() {
    await initVapid(this.prisma).catch(() => undefined);
  }

  /** Respects each user's per-event push / in-app preferences from Settings. */
  async notify(userId: string, kind: NotifyKind, title: string, body: string, href: string | null = null) {
    const s = await this.prisma.db.userSettings.findUnique({ where: { userId }, select: { notifications: true, telegramChatId: true, antiPhishingCode: true } });
    const pref = ((s?.notifications ?? {}) as Record<string, { push?: boolean; app?: boolean; tg?: boolean }>)[kind] ?? { push: true, app: true };
    if (s?.telegramChatId && pref.tg !== false && kind !== 'dm') void sendTelegram(s.telegramChatId, title, body, href, s.antiPhishingCode).catch(() => undefined);
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
    return { publicKey: vapid.publicKey };
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

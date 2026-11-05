import { Body, Controller, Delete, ForbiddenException, Headers, Logger, OnModuleInit, Post } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '@magura/db';
import { CurrentUser, Public } from '../auth/auth.guard';
import { env } from '../config';
import { PrismaService, RedisService } from '../common/infra.module';
import { sendTelegram } from './notifications.module';

/** Link a Telegram chat to a Magura account and receive alerts there. */
@Controller()
export class TelegramController implements OnModuleInit {
  private readonly log = new Logger('telegram');
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    if (!env.TELEGRAM_BOT_TOKEN || !env.API_PUBLIC_URL) return;
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${env.API_PUBLIC_URL}/v1/telegram/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] }),
    }).catch((e) => (this.log.warn(`setWebhook failed: ${(e as Error).message}`), null));
    if (res && !res.ok) this.log.warn(`setWebhook ${res.status}`);
  }

  /** One-time deep link the user opens in Telegram. */
  @Post('me/telegram/link')
  async link(@CurrentUser() user: User) {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME) return { available: false };
    const token = randomBytes(12).toString('hex');
    await this.redis.client.set(`tglink:${token}`, user.id, 'EX', 600);
    return { available: true, url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${token}` };
  }

  @Delete('me/telegram')
  async unlink(@CurrentUser() user: User) {
    await this.prisma.db.userSettings.updateMany({ where: { userId: user.id }, data: { telegramChatId: null } });
    return { ok: true };
  }

  @Public()
  @Post('telegram/webhook')
  async webhook(@Body() update: { message?: { chat?: { id: number }; text?: string } }, @Headers('x-telegram-bot-api-secret-token') secret?: string) {
    if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) throw new ForbiddenException();
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim() ?? '';
    if (!chatId) return { ok: true };
    const [cmd, arg] = text.split(/\s+/, 2);
    if (cmd === '/start' && arg) {
      const userId = await this.redis.client.getdel(`tglink:${arg}`);
      if (!userId) {
        await sendTelegram(String(chatId), 'Link expired', 'Open Settings › Notifications in Magura and tap Connect Telegram again.', '/settings');
        return { ok: true };
      }
      await this.prisma.db.userSettings.upsert({ where: { userId }, update: { telegramChatId: String(chatId) }, create: { userId, telegramChatId: String(chatId) } });
      const u = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { handle: true } });
      await sendTelegram(String(chatId), `Connected to @${u?.handle ?? 'your account'}`, 'You will get Magura alerts here: tracked wallets, friends buying your coins, orders filling, loud rooms. Send /stop to disconnect.', '/settings');
    } else if (cmd === '/stop') {
      await this.prisma.db.userSettings.updateMany({ where: { telegramChatId: String(chatId) }, data: { telegramChatId: null } });
      await sendTelegram(String(chatId), 'Disconnected', 'Alerts are off for this chat.', null);
    } else {
      await sendTelegram(String(chatId), 'Magura alerts', 'Connect from Magura: Settings › Notifications › Connect Telegram.', '/settings');
    }
    return { ok: true };
  }
}

import { Body, Controller, Delete, ForbiddenException, Headers, Logger, OnModuleInit, Post } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '@magura/db';
import { CurrentUser, Public } from '../auth/auth.guard';
import { env } from '../config';
import { PrismaService, RedisService } from '../common/infra.module';
import { TelegramBotService, type TgUpdate } from './telegram-bot.service';

/** Link a Telegram chat to a Magura account and receive alerts there. */
@Controller()
export class TelegramController implements OnModuleInit {
  private readonly log = new Logger('telegram');
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly bot: TelegramBotService,
  ) {}

  async onModuleInit() {
    if (!env.TELEGRAM_BOT_TOKEN || !env.API_PUBLIC_URL) return;
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${env.API_PUBLIC_URL}/v1/telegram/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] }),
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
  async webhook(@Body() update: TgUpdate, @Headers('x-telegram-bot-api-secret-token') secret?: string) {
    if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) throw new ForbiddenException();
    // answer Telegram right away; the bot replies on its own
    void this.bot.handle(update);
    return { ok: true };
  }
}

import { Controller, Headers, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.guard';
import { DiscordBotService } from './discord-bot.service';

/** Discord interactions endpoint (slash commands + buttons). Set the app's
 *  "Interactions Endpoint URL" to {API}/v1/discord/interactions. */
@Controller('discord')
export class DiscordController {
  constructor(private readonly bot: DiscordBotService) {}

  @Public()
  @Post('interactions')
  async interactions(@Req() req: RawBodyRequest<Request>, @Headers('x-signature-ed25519') sig?: string, @Headers('x-signature-timestamp') ts?: string) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!this.bot.enabled || !sig || !ts || !this.bot.verify(sig, ts, raw)) {
      throw new UnauthorizedException('bad signature'); // Discord requires 401
    }
    const body = req.body as { type: number; token: string };
    if (body.type === 1) return { type: 1 }; // PING → PONG

    // Acknowledge now (type 5 = command thinking, type 6 = component update),
    // then edit the original message once the data is ready — keeps us under Discord's 3s limit.
    const ackType = body.type === 3 ? 6 : 5;
    void this.bot
      .render(body as never)
      .then((data) => this.bot.followup(body.token, data))
      .catch(() => undefined);
    return { type: ackType };
  }
}

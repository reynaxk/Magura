import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@magura/db';
import { CurrentUser, OptionalUser, Public } from '../auth/auth.guard';
import { parse } from '../common/zod';
import { ChatService } from './chat.service';

@Controller('rooms')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Public()
  @Get(':roomId/messages')
  history(@Param('roomId') roomId: string, @Query('before') before: string | undefined, @OptionalUser() user?: User) {
    return this.chat.history(roomId, user?.id ?? null, before);
  }

  /** REST fallback for sending (sockets are the primary path). */
  @Post(':roomId/messages')
  send(@Param('roomId') roomId: string, @Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ text: z.string().max(1000), attachment: z.any().optional() }), body);
    return this.chat.send(user, roomId, b.text, b.attachment ?? null);
  }
}

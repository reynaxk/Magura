import { Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { User } from '@magura/db';
import { roomIds } from '@magura/shared';
import { CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/infra.module';
import { NotificationsService } from '../notifications/notifications.module';

@Controller('dms')
export class DmsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
  ) {}

  /** Conversations with last message + unread count. */
  @Get()
  async list(@CurrentUser() user: User) {
    const memberships = await this.prisma.db.dmMember.findMany({
      where: { userId: user.id },
      include: {
        room: {
          include: {
            dmMembers: { include: { user: { select: { id: true, handle: true, displayName: true, avatarUrl: true } } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { author: { select: { handle: true } } } },
          },
        },
      },
    });
    const rows = await Promise.all(
      memberships.map(async (m) => {
        const other = m.room.dmMembers.find((x) => x.userId !== user.id)?.user;
        const last = m.room.messages[0];
        const unread = await this.prisma.db.message.count({
          where: { roomId: m.roomId, authorId: { not: user.id }, createdAt: { gt: m.lastReadAt ?? new Date(0) } },
        });
        return {
          roomId: m.roomId,
          accepted: m.accepted,
          with: other,
          lastMessage: last ? { text: last.text || (last.attachment ? 'shared a trade' : ''), from: last.author.handle, at: last.createdAt } : null,
          unread,
        };
      }),
    );
    return rows.sort((a, b) => +(b.lastMessage?.at ?? 0) - +(a.lastMessage?.at ?? 0));
  }

  /** Open (or create) a DM with someone. Respects their "DMs from anyone" setting. */
  @Post('with/:handle')
  async open(@Param('handle') handle: string, @CurrentUser() user: User) {
    const other = await this.prisma.db.user.findUnique({ where: { handle: handle.toLowerCase() }, include: { settings: true } });
    if (!other || other.id === user.id) throw new NotFoundException('user_not_found');
    const id = roomIds.dm(user.id, other.id);
    const exists = await this.prisma.db.room.findUnique({ where: { id } });
    if (exists) return { roomId: id };
    const follows = await this.prisma.db.follow.findUnique({ where: { followerId_followingId: { followerId: other.id, followingId: user.id } } });
    const acceptedByOther = !!follows || (other.settings?.dmsFromAnyone ?? true);
    // When the other person only accepts DMs from people they follow, this lands in their Requests tab.
    await this.prisma.db.room.create({
      data: {
        id,
        kind: 'dm',
        dmMembers: { create: [{ userId: user.id, accepted: true }, { userId: other.id, accepted: acceptedByOther }] },
      },
    });
    await this.notify.notify(other.id, 'dm', acceptedByOther ? `@${user.handle}` : 'New message request', 'Started a conversation', `/messages/${id}`);
    return { roomId: id };
  }

  @Post(':roomId/read')
  async read(@Param('roomId') roomId: string, @CurrentUser() user: User) {
    await this.prisma.db.dmMember.update({ where: { roomId_userId: { roomId, userId: user.id } }, data: { lastReadAt: new Date() } });
    return { ok: true };
  }

  @Post(':roomId/accept')
  async accept(@Param('roomId') roomId: string, @CurrentUser() user: User) {
    const m = await this.prisma.db.dmMember.findUnique({ where: { roomId_userId: { roomId, userId: user.id } } });
    if (!m) throw new ForbiddenException();
    await this.prisma.db.dmMember.update({ where: { roomId_userId: { roomId, userId: user.id } }, data: { accepted: true } });
    return { ok: true };
  }
}

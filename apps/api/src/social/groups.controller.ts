import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@magura/db';
import { roomIds } from '@magura/shared';
import { CurrentUser, OptionalUser, Public } from '../auth/auth.guard';
import { PrismaService } from '../common/infra.module';
import { parse } from '../common/zod';
import { ModerationService } from '../moderation/moderation.service';

const DEFAULT_CHANNELS = [
  { name: 'general', topic: 'Anything goes', kind: 'text' },
  { name: 'calls', topic: 'Spot calls only · entry, target, invalidation', kind: 'calls' },
  { name: 'charts', topic: 'Post your charts', kind: 'text' },
  { name: 'trenches', topic: 'Fresh launches the group is watching', kind: 'text' },
  { name: 'main-desk', topic: 'Voice & video', kind: 'voice' },
];

@Controller('groups')
export class GroupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
  ) {}

  @Public()
  @Get()
  discover() {
    return this.prisma.db.group.findMany({
      where: { isPublic: true },
      orderBy: { members: { _count: 'desc' } },
      take: 50,
      include: { _count: { select: { members: true } } },
    });
  }

  @Get('mine')
  mine(@CurrentUser() user: User) {
    return this.prisma.db.group.findMany({
      where: { members: { some: { userId: user.id } } },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(
      z.object({
        name: z.string().min(2).max(40),
        slug: z.string().regex(/^[a-z0-9-]{2,30}$/),
        description: z.string().max(280).optional(),
        iconUrl: z.string().url().optional(),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        isPublic: z.boolean().default(true),
        rules: z.string().max(1000).optional(),
      }),
      body,
    );
    if (b.iconUrl) await this.moderation.assertImageSafe(b.iconUrl);
    const group = await this.prisma.db.group.create({
      data: {
        ...b,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
        channels: { create: DEFAULT_CHANNELS.map((c, i) => ({ ...c, position: i })) },
      },
      include: { channels: true },
    });
    await this.prisma.db.room.createMany({
      data: group.channels.map((c) => ({ id: roomIds.channel(c.id), kind: 'channel', title: c.name, channelId: c.id })),
    });
    return group;
  }

  @Public()
  @Get(':slug')
  async get(@Param('slug') slug: string, @OptionalUser() user?: User) {
    const g = await this.prisma.db.group.findUnique({
      where: { slug },
      include: {
        channels: { orderBy: { position: 'asc' } },
        _count: { select: { members: true } },
      },
    });
    if (!g) throw new NotFoundException('group_not_found');
    const membership = user ? await this.prisma.db.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: user.id } } }) : null;
    if (!g.isPublic && !membership) throw new ForbiddenException('private_group');
    return { ...g, role: membership?.role ?? null, channels: g.channels.map((c) => ({ ...c, roomId: roomIds.channel(c.id) })) };
  }

  @Public()
  @Get(':slug/members')
  async members(@Param('slug') slug: string) {
    const g = await this.prisma.db.group.findUnique({ where: { slug } });
    if (!g) throw new NotFoundException();
    return this.prisma.db.groupMember.findMany({
      where: { groupId: g.id },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      take: 200,
      include: { user: { select: { id: true, handle: true, displayName: true, avatarUrl: true } } },
    });
  }

  @Post(':slug/join')
  async join(@Param('slug') slug: string, @CurrentUser() user: User) {
    const g = await this.prisma.db.group.findUnique({ where: { slug } });
    if (!g) throw new NotFoundException();
    if (!g.isPublic) throw new ForbiddenException('invite_only');
    await this.prisma.db.groupMember.upsert({ where: { groupId_userId: { groupId: g.id, userId: user.id } }, update: {}, create: { groupId: g.id, userId: user.id } });
    return { ok: true };
  }

  @Delete(':slug/join')
  async leave(@Param('slug') slug: string, @CurrentUser() user: User) {
    const g = await this.prisma.db.group.findUnique({ where: { slug } });
    if (!g) throw new NotFoundException();
    if (g.ownerId === user.id) throw new ForbiddenException('owner_cannot_leave');
    await this.prisma.db.groupMember.deleteMany({ where: { groupId: g.id, userId: user.id } });
    return { ok: true };
  }

  @Patch(':slug/members/:userId')
  async role(@Param('slug') slug: string, @Param('userId') userId: string, @Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ role: z.enum(['lead', 'member']) }), body);
    const g = await this.prisma.db.group.findUnique({ where: { slug } });
    if (!g || g.ownerId !== user.id) throw new ForbiddenException();
    return this.prisma.db.groupMember.update({ where: { groupId_userId: { groupId: g.id, userId } }, data: { role: b.role } });
  }

  @Post(':slug/channels')
  async addChannel(@Param('slug') slug: string, @Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ name: z.string().regex(/^[a-z0-9-]{2,24}$/), topic: z.string().max(120).optional(), kind: z.enum(['text', 'calls', 'voice']) }), body);
    const g = await this.prisma.db.group.findUnique({ where: { slug } });
    if (!g) throw new NotFoundException();
    const m = await this.prisma.db.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: user.id } } });
    if (!m || m.role === 'member') throw new ForbiddenException();
    const count = await this.prisma.db.channel.count({ where: { groupId: g.id } });
    const ch = await this.prisma.db.channel.create({ data: { ...b, groupId: g.id, position: count } });
    await this.prisma.db.room.create({ data: { id: roomIds.channel(ch.id), kind: 'channel', title: ch.name, channelId: ch.id } });
    return ch;
  }
}

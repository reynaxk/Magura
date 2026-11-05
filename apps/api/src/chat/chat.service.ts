import { dexscreener } from '@magura/chains';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Message, User } from '@magura/db';
import { CHAINS, isChainId, type ChatMessageDTO } from '@magura/shared';
import { PrismaService, RedisService } from '../common/infra.module';
import { RealtimeService } from '../realtime/realtime.service';

const MAX_LEN = 1000;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rt: RealtimeService,
  ) {}

  toDTO(m: Message & { author: Pick<User, 'id' | 'handle' | 'avatarUrl' | 'badges'> }): ChatMessageDTO {
    return {
      id: m.id,
      roomId: m.roomId,
      author: { id: m.author.id, handle: m.author.handle, avatarUrl: m.author.avatarUrl, badges: m.author.badges },
      text: m.text,
      attachment: (m.attachment as ChatMessageDTO['attachment']) ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  /**
   * Make sure a room exists and the user may access it.
   * Coin rooms are created lazily the first time anyone opens a token.
   */
  async ensureAccess(roomId: string, userId: string | null, mode: 'read' | 'write' = 'read'): Promise<void> {
    const [kind, ...rest] = roomId.split(':');
    if (kind === 'world') return;
    if (kind === 'coin') {
      const [chain, address] = rest;
      if (!chain || !address || !isChainId(chain)) throw new NotFoundException('room_not_found');
      await this.prisma.db.room.upsert({
        where: { id: roomId },
        update: {},
        create: { id: roomId, kind: 'coin', chain, tokenAddress: address, title: `${CHAINS[chain].name} coin room` },
      });
      return;
    }
    const room = await this.prisma.db.room.findUnique({
      where: { id: roomId },
      include: { channel: { select: { groupId: true, group: { select: { isPublic: true } } } } },
    });
    if (!room) throw new NotFoundException('room_not_found');
    if (room.kind === 'stream') return;
    if (room.kind === 'channel' && room.channel?.group.isPublic && mode === 'read') return;
    if (!userId) throw new ForbiddenException('login_required');
    if (room.kind === 'dm') {
      const member = await this.prisma.db.dmMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
      if (!member) throw new ForbiddenException('not_a_member');
      return;
    }
    if (room.kind === 'channel' && room.channel) {
      // public groups: anyone can read, members can write
      const member = await this.prisma.db.groupMember.findUnique({
        where: { groupId_userId: { groupId: room.channel.groupId, userId } },
      });
      if (!member) throw new ForbiddenException('not_a_member');
    }
  }

  async history(roomId: string, userId: string | null, before?: string, limit = 50): Promise<ChatMessageDTO[]> {
    await this.ensureAccess(roomId, userId);
    const rows = await this.prisma.db.message.findMany({
      where: { roomId, deletedAt: null, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: { author: { select: { id: true, handle: true, avatarUrl: true, badges: true } } },
    });
    return rows.reverse().map((m) => this.toDTO(m));
  }

  async send(user: User, roomId: string, text: string, attachment: ChatMessageDTO['attachment'] = null): Promise<ChatMessageDTO> {
    const clean = text.replace(/\s+$/g, '').slice(0, MAX_LEN);
    if (!clean && !attachment) throw new ForbiddenException('empty_message');
    await this.ensureAccess(roomId, user.id, 'write');

    // spam control: 8 messages / 10s per user, plus per-room slow mode
    if (!(await this.redis.allow(`chat:${user.id}`, 8, 10))) throw new ForbiddenException('slow_down');
    const room = await this.prisma.db.room.findUnique({ where: { id: roomId }, select: { slowModeSec: true, kind: true } });
    if (room?.slowModeSec && !(await this.redis.allow(`slow:${roomId}:${user.id}`, 1, room.slowModeSec))) {
      throw new ForbiddenException('slow_mode');
    }
    if (room?.kind === 'world') {
      const s = await this.prisma.db.userSettings.findUnique({ where: { userId: user.id }, select: { showInWorld: true } });
      if (s && !s.showInWorld) throw new ForbiddenException('world_chat_disabled_in_settings');
    }

    if (attachment?.kind === 'call') {
      const c = attachment;
      const addr = c.chain === 'solana' ? c.token.address : c.token.address.toLowerCase();
      const [pair, row] = await Promise.all([
        dexscreener.bestPair(c.chain, addr).catch(() => null),
        this.prisma.db.token.findUnique({ where: { chain_address: { chain: c.chain, address: addr } } }),
      ]);
      attachment = { ...c, priceAtCall: pair?.priceUsd ?? row?.priceUsd ?? null };
    }
    const msg = await this.prisma.db.message.create({
      data: { roomId, authorId: user.id, text: clean, attachment: (attachment ?? undefined) as object | undefined },
      include: { author: { select: { id: true, handle: true, avatarUrl: true, badges: true } } },
    });
    const dto = this.toDTO(msg);
    this.rt.toRoom(roomId, 'chat:message', dto);
    await this.redis.client.incr(`roomcount:${roomId}`);
    return dto;
  }

  /** Message counts per coin room — powers the "chat" badge on trenches cards. */
  async coinRoomCounts(roomIds: string[]): Promise<Record<string, number>> {
    if (!roomIds.length) return {};
    const vals = await this.redis.client.mget(roomIds.map((r) => `roomcount:${r}`));
    return Object.fromEntries(roomIds.map((r, i) => [r, Number(vals[i] ?? 0)]));
  }
}

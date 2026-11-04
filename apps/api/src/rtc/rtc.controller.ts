import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@magura/db';
import { roomIds, type RtcTrack } from '@magura/shared';
import { CurrentUser, OptionalUser, Public } from '../auth/auth.guard';
import { PrismaService, RedisService } from '../common/infra.module';
import { parse } from '../common/zod';
import { NotificationsService } from '../notifications/notifications.module';
import { RealtimeService } from '../realtime/realtime.service';
import { cfRealtime, realtimeConfigured } from './cloudflare-realtime';

const zSdp = z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(200_000) });

/**
 * Calls (1:1 DM, group voice rooms) and live streams.
 * A "scope" is `call:<id>` or `stream:<id>`; the published tracks of a scope live in
 * Redis so newcomers know what to pull.
 */
@Controller()
export class RtcController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rt: RealtimeService,
    private readonly notify: NotificationsService,
  ) {}

  @Public()
  @Get('rtc/config')
  async config() {
    return { enabled: realtimeConfigured(), iceServers: await cfRealtime.iceServers().catch(() => []) };
  }

  // ───── calls ─────

  /** Start a call in a DM room or a group voice channel. */
  @Post('calls')
  async startCall(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ roomId: z.string().optional(), channelId: z.string().optional(), video: z.boolean().default(false) }), body);
    let notifyIds: string[] = [];
    if (b.roomId) {
      const members = await this.prisma.db.dmMember.findMany({ where: { roomId: b.roomId } });
      if (!members.some((m) => m.userId === user.id)) throw new ForbiddenException();
      notifyIds = members.map((m) => m.userId).filter((id) => id !== user.id);
    } else if (b.channelId) {
      const ch = await this.prisma.db.channel.findUnique({ where: { id: b.channelId } });
      if (!ch || ch.kind !== 'voice') throw new NotFoundException('voice_channel_not_found');
      const live = await this.prisma.db.call.findFirst({ where: { channelId: ch.id, endedAt: null } });
      if (live) return live; // voice rooms have one ongoing call
    } else throw new ForbiddenException('roomId_or_channelId_required');

    const call = await this.prisma.db.call.create({
      data: { kind: b.roomId ? 'dm' : 'voice_room', video: b.video, roomId: b.roomId, channelId: b.channelId, creatorId: user.id },
    });
    for (const id of notifyIds) {
      this.rt.toUser(id, 'call:ring', { callId: call.id, from: { id: user.id, handle: user.handle }, video: b.video });
      await this.notify.notify(id, 'call', `@${user.handle} is calling`, b.video ? 'Video call' : 'Voice call', `/messages/${b.roomId}`);
    }
    return call;
  }

  @Post('calls/:id/join')
  async joinCall(@Param('id') id: string, @CurrentUser() user: User) {
    const call = await this.prisma.db.call.findUnique({ where: { id } });
    if (!call || call.endedAt) throw new NotFoundException('call_not_found');
    await this.assertCallAccess(call, user.id);
    const { sessionId } = await cfRealtime.newSession();
    await this.prisma.db.callParticipant.upsert({
      where: { callId_userId: { callId: id, userId: user.id } },
      update: { cfSessionId: sessionId, leftAt: null },
      create: { callId: id, userId: user.id, cfSessionId: sessionId },
    });
    await this.redis.client.set(`rtc:session:${sessionId}`, JSON.stringify({ userId: user.id, scope: `call:${id}` }), 'EX', 86400);
    return { sessionId, iceServers: await cfRealtime.iceServers(), tracks: await this.tracks(`call:${id}`) };
  }

  @Post('calls/:id/leave')
  async leaveCall(@Param('id') id: string, @CurrentUser() user: User) {
    await this.prisma.db.callParticipant.updateMany({ where: { callId: id, userId: user.id }, data: { leftAt: new Date() } });
    await this.dropUserTracks(`call:${id}`, user.id);
    const remaining = await this.prisma.db.callParticipant.count({ where: { callId: id, leftAt: null } });
    if (remaining === 0) {
      await this.prisma.db.call.update({ where: { id }, data: { endedAt: new Date() } });
      const all = await this.prisma.db.callParticipant.findMany({ where: { callId: id } });
      for (const p of all) this.rt.toUser(p.userId, 'call:ended', { callId: id });
    }
    return { ok: true };
  }

  // ───── streams ─────

  @Public()
  @Get('streams')
  live() {
    return this.prisma.db.stream.findMany({
      where: { status: 'live' },
      orderBy: { viewers: 'desc' },
      take: 50,
      include: { host: { select: { handle: true, displayName: true, avatarUrl: true } } },
    });
  }

  @Post('streams')
  async goLive(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ title: z.string().min(3).max(100), tags: z.array(z.string().max(80)).max(5).default([]) }), body);
    await this.prisma.db.stream.updateMany({ where: { hostId: user.id, status: 'live' }, data: { status: 'ended', endedAt: new Date() } });
    const { sessionId } = await cfRealtime.newSession();
    const stream = await this.prisma.db.stream.create({ data: { hostId: user.id, title: b.title, tags: b.tags, cfSessionId: sessionId } });
    await this.prisma.db.room.create({ data: { id: roomIds.stream(stream.id), kind: 'stream', title: b.title, slowModeSec: 3 } });
    await this.redis.client.set(`rtc:session:${sessionId}`, JSON.stringify({ userId: user.id, scope: `stream:${stream.id}` }), 'EX', 86400);
    const followers = await this.prisma.db.follow.findMany({ where: { followingId: user.id }, select: { followerId: true }, take: 5000 });
    for (const f of followers) {
      this.rt.toUser(f.followerId, 'stream:live', { streamId: stream.id, hostHandle: user.handle, title: b.title });
      void this.notify.notify(f.followerId, 'live', `@${user.handle} is live`, b.title, `/live/${stream.id}`);
    }
    return { stream, sessionId, iceServers: await cfRealtime.iceServers() };
  }

  @Post('streams/:id/end')
  async endStream(@Param('id') id: string, @CurrentUser() user: User) {
    const s = await this.prisma.db.stream.findUnique({ where: { id } });
    if (!s || s.hostId !== user.id) throw new ForbiddenException();
    await this.prisma.db.stream.update({ where: { id }, data: { status: 'ended', endedAt: new Date() } });
    await this.redis.client.del(`rtc:tracks:stream:${id}`);
    this.rt.toRoom(roomIds.stream(id), 'rtc:tracks', { scope: `stream:${id}`, tracks: [] });
    return { ok: true };
  }

  /** Viewers get their own receive-only session. */
  @Public()
  @Post('streams/:id/watch')
  async watch(@Param('id') id: string, @OptionalUser() user?: User) {
    const s = await this.prisma.db.stream.findUnique({ where: { id }, include: { host: { select: { handle: true, displayName: true, avatarUrl: true } } } });
    if (!s || s.status !== 'live') throw new NotFoundException('stream_offline');
    const { sessionId } = await cfRealtime.newSession();
    await this.redis.client.set(`rtc:session:${sessionId}`, JSON.stringify({ userId: user?.id ?? 'anon', scope: `stream:${id}`, viewer: true }), 'EX', 21600);
    await this.prisma.db.stream.update({ where: { id }, data: { viewers: { increment: 1 } } });
    return { stream: s, sessionId, iceServers: await cfRealtime.iceServers(), tracks: await this.tracks(`stream:${id}`) };
  }

  // ───── SFU signalling (shared by calls and streams) ─────

  @Public()
  @Post('rtc/sessions/:sessionId/publish')
  async publish(@Param('sessionId') sessionId: string, @Body() body: unknown, @OptionalUser() user?: User) {
    const b = parse(z.object({ offer: zSdp, tracks: z.array(z.object({ mid: z.string(), trackName: z.string().max(64), kind: z.enum(['audio', 'video', 'screen']) })).min(1).max(4) }), body);
    const owner = await this.sessionOwner(sessionId);
    if (!user || owner.userId !== user.id || owner.viewer) throw new ForbiddenException('not_your_session');
    const res = await cfRealtime.newTracks(sessionId, b.tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: t.trackName })), b.offer);
    const key = `rtc:tracks:${owner.scope}`;
    for (const t of b.tracks) {
      const track: RtcTrack = { userId: user.id, handle: user.handle, sessionId, trackName: t.trackName, kind: t.kind };
      await this.redis.client.hset(key, `${user.id}:${t.trackName}`, JSON.stringify(track));
    }
    await this.redis.client.expire(key, 86400);
    await this.broadcastTracks(owner.scope);
    return res;
  }

  @Public()
  @Post('rtc/sessions/:sessionId/pull')
  async pull(@Param('sessionId') sessionId: string, @Body() body: unknown) {
    const b = parse(z.object({ tracks: z.array(z.object({ sessionId: z.string(), trackName: z.string() })).min(1).max(24) }), body);
    const owner = await this.sessionOwner(sessionId);
    const published = await this.tracks(owner.scope);
    const allowed = b.tracks.filter((t) => published.some((p) => p.sessionId === t.sessionId && p.trackName === t.trackName));
    if (!allowed.length) throw new NotFoundException('tracks_not_found');
    return cfRealtime.newTracks(sessionId, allowed.map((t) => ({ location: 'remote', sessionId: t.sessionId, trackName: t.trackName })));
  }

  @Public()
  @Post('rtc/sessions/:sessionId/renegotiate')
  async renegotiate(@Param('sessionId') sessionId: string, @Body() body: unknown) {
    await this.sessionOwner(sessionId);
    const b = parse(z.object({ answer: zSdp }), body);
    return cfRealtime.renegotiate(sessionId, b.answer);
  }

  @Public()
  @Post('rtc/sessions/:sessionId/close')
  async close(@Param('sessionId') sessionId: string, @Body() body: unknown, @OptionalUser() user?: User) {
    const b = parse(z.object({ mids: z.array(z.string()).min(1), offer: zSdp.optional(), trackNames: z.array(z.string()).default([]) }), body);
    const owner = await this.sessionOwner(sessionId);
    if (user && owner.userId === user.id) {
      for (const n of b.trackNames) await this.redis.client.hdel(`rtc:tracks:${owner.scope}`, `${user.id}:${n}`);
      await this.broadcastTracks(owner.scope);
    }
    return cfRealtime.closeTracks(sessionId, b.mids, b.offer);
  }

  // ───── helpers ─────

  private async sessionOwner(sessionId: string): Promise<{ userId: string; scope: string; viewer?: boolean }> {
    const raw = await this.redis.client.get(`rtc:session:${sessionId}`);
    if (!raw) throw new NotFoundException('session_not_found');
    return JSON.parse(raw);
  }

  private async tracks(scope: string): Promise<RtcTrack[]> {
    const all = await this.redis.client.hvals(`rtc:tracks:${scope}`);
    return all.map((t) => JSON.parse(t) as RtcTrack);
  }

  private async dropUserTracks(scope: string, userId: string) {
    const key = `rtc:tracks:${scope}`;
    const fields = (await this.redis.client.hkeys(key)).filter((f) => f.startsWith(`${userId}:`));
    if (fields.length) await this.redis.client.hdel(key, ...fields);
    await this.broadcastTracks(scope);
  }

  private async broadcastTracks(scope: string) {
    const tracks = await this.tracks(scope);
    const [kind, id] = scope.split(':');
    if (kind === 'stream') this.rt.toRoom(roomIds.stream(id), 'rtc:tracks', { scope, tracks });
    else {
      const ps = await this.prisma.db.callParticipant.findMany({ where: { callId: id, leftAt: null } });
      for (const p of ps) this.rt.toUser(p.userId, 'rtc:tracks', { scope, tracks });
    }
  }

  private async assertCallAccess(call: { roomId: string | null; channelId: string | null }, userId: string) {
    if (call.roomId) {
      const m = await this.prisma.db.dmMember.findUnique({ where: { roomId_userId: { roomId: call.roomId, userId } } });
      if (!m) throw new ForbiddenException();
    } else if (call.channelId) {
      const ch = await this.prisma.db.channel.findUnique({ where: { id: call.channelId }, include: { group: true } });
      if (!ch) throw new NotFoundException();
      if (!ch.group.isPublic) {
        const m = await this.prisma.db.groupMember.findUnique({ where: { groupId_userId: { groupId: ch.groupId, userId } } });
        if (!m) throw new ForbiddenException();
      }
    }
  }
}

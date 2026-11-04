import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { CHAIN_IDS, type ChatMessageDTO } from '@magura/shared';
import { AuthService } from '../auth/auth.service';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../common/infra.module';
import { RealtimeService, type IoServer } from './realtime.service';

type AppSocket = Socket & { data: { userId?: string; handle?: string } };

@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('ws');

  constructor(
    private readonly auth: AuthService,
    private readonly chat: ChatService,
    private readonly rt: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(io: IoServer) {
    this.rt.attach(io);
  }

  /** Anonymous sockets may read public rooms; sending requires a user. */
  async handleConnection(socket: AppSocket) {
    const { token, devUser } = (socket.handshake.auth ?? {}) as { token?: string; devUser?: string };
    if (!token && !devUser) return;
    try {
      const user = await this.auth.userFromToken(token, devUser);
      socket.data.userId = user.id;
      socket.data.handle = user.handle;
      socket.join(`user:${user.id}`);
    } catch {
      socket.emit('notification', { id: 'auth', kind: 'system', title: 'Session expired', body: 'Please log in again', href: null });
    }
  }

  async handleDisconnect(socket: AppSocket) {
    for (const room of socket.rooms) if (room !== socket.id) void this.broadcastPresence(room);
  }

  @SubscribeMessage('room:join')
  async join(@ConnectedSocket() socket: AppSocket, @MessageBody() roomId: string) {
    try {
      await this.chat.ensureAccess(String(roomId), socket.data.userId ?? null);
      await socket.join(roomId);
      void this.broadcastPresence(roomId);
      return true;
    } catch (e) {
      this.log.debug(`join denied ${roomId}: ${(e as Error).message}`);
      return false;
    }
  }

  @SubscribeMessage('room:leave')
  async leave(@ConnectedSocket() socket: AppSocket, @MessageBody() roomId: string) {
    await socket.leave(roomId);
    void this.broadcastPresence(roomId);
  }

  @SubscribeMessage('chat:send')
  async send(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() p: { roomId: string; text: string; attachment?: ChatMessageDTO['attachment'] },
  ) {
    if (!socket.data.userId) return { ok: false, error: 'login_required' };
    try {
      const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: socket.data.userId } });
      const message = await this.chat.send(user, p.roomId, String(p.text ?? ''), p.attachment ?? null);
      return { ok: true, message };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('chat:typing')
  typing(@ConnectedSocket() socket: AppSocket, @MessageBody() roomId: string) {
    if (!socket.data.userId || !socket.rooms.has(roomId)) return;
    socket.to(roomId).emit('chat:typing', { roomId, userId: socket.data.userId, handle: socket.data.handle ?? '' });
  }

  @SubscribeMessage('trenches:subscribe')
  async trenches(@ConnectedSocket() socket: AppSocket, @MessageBody() chains: string[]) {
    for (const c of CHAIN_IDS) socket.leave(`trenches:${c}`);
    for (const c of (chains ?? []).filter((x) => (CHAIN_IDS as string[]).includes(x))) await socket.join(`trenches:${c}`);
  }

  private async broadcastPresence(roomId: string) {
    if (roomId.startsWith('user:') || roomId.startsWith('trenches:')) return;
    const online = await this.rt.roomSize(roomId);
    this.rt.toRoom(roomId, 'chat:presence', { roomId, online });
  }
}

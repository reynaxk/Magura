import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@magura/shared';

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Lets any service push realtime events without depending on the gateway. */
@Injectable()
export class RealtimeService {
  private io: IoServer | null = null;

  attach(io: IoServer) {
    this.io = io;
  }

  toRoom<E extends keyof ServerToClientEvents>(room: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.io?.to(room).emit(event, ...args);
  }

  /** Every user socket joins `user:<id>` on connect. */
  toUser<E extends keyof ServerToClientEvents>(userId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.io?.to(`user:${userId}`).emit(event, ...args);
  }

  async roomSize(room: string): Promise<number> {
    if (!this.io) return 0;
    const sockets = await this.io.in(room).fetchSockets();
    return new Set(sockets.map((s) => s.data.userId)).size;
  }
}

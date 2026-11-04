import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { env } from '../config';

/** Socket.IO adapter backed by Redis pub/sub so multiple API instances share rooms. */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  async connectToRedis(url: string) {
    const pub = new Redis(url);
    const sub = pub.duplicate();
    this.adapterConstructor = createAdapter(pub, sub);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: env.WEB_ORIGIN.split(','), credentials: true },
      transports: ['websocket', 'polling'],
    });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}

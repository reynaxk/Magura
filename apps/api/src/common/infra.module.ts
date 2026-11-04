import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { prisma, type PrismaClient } from '@magura/db';
import Redis from 'ioredis';
import { env } from '../config';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: PrismaClient = prisma;
  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });

  async cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.client.get(key);
    if (hit) return JSON.parse(hit) as T;
    const value = await load();
    if (value !== undefined) await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
    return value;
  }

  /** Fixed-window rate limit. Returns true when allowed. */
  async allow(key: string, limit: number, windowSec: number): Promise<boolean> {
    const k = `rl:${key}`;
    const n = await this.client.incr(k);
    if (n === 1) await this.client.expire(k, windowSec);
    return n <= limit;
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService, RedisService], exports: [PrismaService, RedisService] })
export class InfraModule {}

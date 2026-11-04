import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { roomIds } from '@magura/shared';
import { PrismaService } from './infra.module';

/**
 * Makes sure the rooms every deployment needs exist (World chat and the Magura HQ group).
 * Idempotent, so it is safe on every boot and replaces a manual seed step in production.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger('bootstrap');

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    const db = this.prisma.db;
    try {
      await db.room.upsert({ where: { id: 'world' }, update: {}, create: { id: 'world', kind: 'world', title: 'World chat', slowModeSec: 2 } });
      const system = await db.user.upsert({
        where: { privyId: 'system' },
        update: {},
        create: { privyId: 'system', handle: 'magura', displayName: 'Magura' },
      });
      const group = await db.group.upsert({
        where: { slug: 'magura-hq' },
        update: {},
        create: {
          slug: 'magura-hq',
          name: 'Magura HQ',
          description: 'Official community. Announcements, feedback, and spot calls.',
          color: '#C8F05A',
          ownerId: system.id,
          rules: 'Spot calls only. Every call needs an invalidation level. No shilling your own launches.',
          members: { create: { userId: system.id, role: 'owner' } },
        },
      });
      const channels = [
        { name: 'general', topic: 'Anything goes', kind: 'text' },
        { name: 'calls', topic: 'Spot calls only · entry, target, invalidation', kind: 'calls' },
        { name: 'charts', topic: 'Post your charts', kind: 'text' },
        { name: 'trenches', topic: 'Fresh launches the group is watching', kind: 'text' },
        { name: 'announcements', topic: 'From the team', kind: 'text' },
        { name: 'main-desk', topic: 'Voice & video', kind: 'voice' },
      ];
      for (const [position, c] of channels.entries()) {
        const ch = await db.channel.upsert({
          where: { groupId_name: { groupId: group.id, name: c.name } },
          update: {},
          create: { ...c, position, groupId: group.id },
        });
        await db.room.upsert({
          where: { id: roomIds.channel(ch.id) },
          update: {},
          create: { id: roomIds.channel(ch.id), kind: 'channel', title: c.name, channelId: ch.id },
        });
      }
    } catch (e) {
      this.log.warn(`bootstrap skipped: ${(e as Error).message}`);
    }
  }
}

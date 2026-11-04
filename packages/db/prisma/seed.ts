import 'dotenv/config';
import { prisma } from '../src';

/** Seeds the rooms that must always exist. Safe to run repeatedly. */
async function main() {
  await prisma.room.upsert({
    where: { id: 'world' },
    update: {},
    create: { id: 'world', kind: 'world', title: 'World chat', slowModeSec: 2 },
  });

  // A system user owns the default public group.
  const system = await prisma.user.upsert({
    where: { privyId: 'system' },
    update: {},
    create: { privyId: 'system', handle: 'magura', displayName: 'Magura' },
  });

  const group = await prisma.group.upsert({
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
    { name: 'general', topic: 'Anything goes', kind: 'text', position: 0 },
    { name: 'calls', topic: 'Spot calls only · entry, target, invalidation', kind: 'calls', position: 1 },
    { name: 'charts', topic: 'Post your charts', kind: 'text', position: 2 },
    { name: 'trenches', topic: 'Fresh launches the group is watching', kind: 'text', position: 3 },
    { name: 'announcements', topic: 'From the team', kind: 'text', position: 4 },
    { name: 'main-desk', topic: 'Voice & video', kind: 'voice', position: 5 },
  ];
  for (const c of channels) {
    const ch = await prisma.channel.upsert({
      where: { groupId_name: { groupId: group.id, name: c.name } },
      update: {},
      create: { ...c, groupId: group.id },
    });
    await prisma.room.upsert({
      where: { id: `channel:${ch.id}` },
      update: {},
      create: { id: `channel:${ch.id}`, kind: 'channel', title: c.name, channelId: ch.id },
    });
  }
  console.log('Seeded world room and Magura HQ');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

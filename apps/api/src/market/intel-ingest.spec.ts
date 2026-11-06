/**
 * Ledger ingest against real Redis + Postgres: slot-based bundle detection, duplicate trades
 * from overlapping sources, and the supply split written back to the coin.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

process.env.TRENCHES_WORKER = '0';

let app: INestApplicationContext;

before(async () => {
  const { AppModule } = await import('../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
});
after(async () => app?.close());

test('same slot as the launch = bundler; replays are ignored; split lands on the coin', async () => {
  const { PrismaService } = await import('../common/infra.module');
  const { IntelService } = await import('./intel.service');
  const db = app.get(PrismaService).db;
  const intel = app.get(IntelService);
  const stamp = Date.now().toString(36);
  const mint = `Mint${stamp}`.padEnd(44, '1');
  const launched = new Date(Date.now() - 60_000);
  await db.token.create({ data: { chain: 'solana', address: mint, symbol: 'TST', name: 'Test', launchpad: 'pumpfun', creator: 'DEV', createdAt: launched, stage: 'new' } });

  const t = (sig: string, wallet: string, side: 'buy' | 'sell', tokens: number, sol: number, msAfter: number, slot: number) => ({
    signature: sig,
    wallet,
    side,
    tokenAmount: tokens,
    nativeAmount: sol,
    at: new Date(launched.getTime() + msAfter),
    slot,
  });
  const batch = [
    t('s1', 'DEV', 'buy', 40_000_000, 1.2, 0, 100),
    t('s2', 'BUNDLE', 'buy', 50_000_000, 1.5, 0, 100), // same slot as the dev's create
    t('s3', 'SNIPER', 'buy', 30_000_000, 1, 2_000, 105),
    t('s4', 'LATE', 'buy', 10_000_000, 0.5, 40_000, 190),
  ];
  await intel.ingest('solana', mint, batch);
  await intel.ingest('solana', mint, batch); // the same trades again from another source

  const rows = await intel.holders('solana', mint, 'holding', null, null);
  assert.ok(rows);
  const by = Object.fromEntries(rows.map((r) => [r.wallet, r]));
  assert.ok(by.BUNDLE.tags.includes('bundler'));
  assert.ok(by.SNIPER.tags.includes('sniper'));
  assert.ok(!by.LATE.tags.includes('sniper'));
  assert.equal(by.BUNDLE.buys, 1, 'duplicate trades must not double count');

  const row = await db.token.findUniqueOrThrow({ where: { chain_address: { chain: 'solana', address: mint } } });
  const split = row.intel as { bundlerPct: number; sniperPct: number; devPct: number; holders: number };
  assert.equal(split.holders, 4);
  assert.equal(split.bundlerPct, 5);
  assert.equal(split.sniperPct, 3);
  assert.equal(split.devPct, 4);
});

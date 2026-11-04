/**
 * Integration test for the copy engine against a real Postgres/Redis
 * (run with the API's .env). Skips when DATABASE_URL isn't reachable.
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

test('leader buy fans out to copiers with limits applied', async () => {
  const { PrismaService } = await import('../common/infra.module');
  const { CopyService } = await import('./copy.service');
  const db = app.get(PrismaService).db;
  const copy = app.get(CopyService);

  const stamp = Date.now().toString(36);
  const leader = await db.user.create({ data: { privyId: `t:l:${stamp}`, handle: `lead${stamp}`, settings: { create: {} } } });
  const copier = await db.user.create({ data: { privyId: `t:c:${stamp}`, handle: `copy${stamp}`, settings: { create: {} } } });
  const memeOnly = await db.user.create({ data: { privyId: `t:m:${stamp}`, handle: `meme${stamp}`, settings: { create: {} } } });

  await copy.subscribe(copier, leader.handle, { budgetUsd: 1000 as any, maxPerBuyUsd: 120 as any, memecoins: true });
  await copy.subscribe(memeOnly, leader.handle, { budgetUsd: 1000 as any, memecoins: false });

  // Established token (big MC) and a fresh launchpad token
  const SOL_TOKEN = `Tok${stamp}`.padEnd(44, '1');
  await db.token.create({ data: { chain: 'solana', address: SOL_TOKEN, symbol: 'MEME', name: 'Meme', launchpad: 'pumpfun' } });

  const trade = await db.trade.create({
    data: { userId: leader.id, chain: 'solana', side: 'buy', tokenAddress: SOL_TOKEN, tokenSymbol: 'MEME', amountIn: '1', amountOut: '1000', amountUsd: 500, provider: 'jupiter', txHash: 'x', status: 'confirmed' },
  });

  // leader reports a $2,000 wallet → 25% proportion → $250 → capped at $120
  await (copy as any).onTradeConfirmed(trade, { portfolioUsd: 2000 });

  const execs = await db.copyExecution.findMany({ where: { leaderTradeId: trade.id }, include: { subscription: true } });
  const forCopier = execs.find((e) => e.subscription.copierId === copier.id)!;
  const forMeme = execs.find((e) => e.subscription.copierId === memeOnly.id)!;

  assert.equal(Number(forCopier.amountUsd), 120, 'capped at max per buy');
  assert.equal(forCopier.status, 'awaiting_confirm', 'no delegated wallet → ask the copier');
  assert.equal(forMeme.status, 'skipped');
  assert.equal(forMeme.skipReason, 'memecoins_disabled');

  // idempotent: replaying the same leader trade creates nothing new
  await (copy as any).onTradeConfirmed(trade, { portfolioUsd: 2000 });
  assert.equal(await db.copyExecution.count({ where: { leaderTradeId: trade.id } }), 2);

  const pending = await copy.pendingConfirmations(copier);
  assert.equal(pending.length, 1);
});

/** Gas reserve: buys can't spend the SOL/ETH/BNB needed for network fees. Needs Postgres + Redis. */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

process.env.TRENCHES_WORKER = '0';
let app: INestApplicationContext;

before(async () => {
  // Fake Solana RPC: wallet holds 0.5 SOL
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (body?.method === 'getBalance') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 500_000_000 } }));
    return realFetch(url, init);
  }) as typeof fetch;
  const { AppModule } = await import('../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const { RedisService } = await import('../common/infra.module');
  await app.get(RedisService).client.set('majors', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }), 'EX', 60);
});
after(async () => app?.close());

const W = 'So11111111111111111111111111111111111111112';

test('buying the whole balance is blocked and tells the max', async () => {
  const { TradingService } = await import('./trading.service');
  const t = app.get(TradingService);
  await assert.rejects(
    t.quote({ chain: 'solana', side: 'buy', token: W, amount: '0.5', slippageBps: 100, wallet: W }),
    (e: any) => {
      const b = e.getResponse();
      assert.equal(b.error, 'low_gas');
      assert.equal(b.maxBuy, '0.49');
      assert.match(b.message, /Keep 0.01 SOL for gas/);
      return true;
    },
  );
});

test('buy under the minimum is rejected before gas or routing', async () => {
  const { TradingService } = await import('./trading.service');
  const t = app.get(TradingService);
  await assert.rejects(t.quote({ chain: 'solana', side: 'buy', token: W, amount: '0.01', slippageBps: 100, wallet: W }), /min_trade_2_usd/);
});

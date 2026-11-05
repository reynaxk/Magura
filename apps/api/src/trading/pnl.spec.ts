import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computePnl } from './pnl';
import { stageFor } from '../market/trenches.service';

test('realized PnL on a partial then full exit', () => {
  const r = computePnl([
    { tokenKey: 's:A', side: 'buy', amountIn: '1', amountOut: '1000', amountUsd: 100 },
    { tokenKey: 's:A', side: 'sell', amountIn: '500', amountOut: '1', amountUsd: 80 }, // +30 on half
    { tokenKey: 's:A', side: 'sell', amountIn: '500', amountOut: '1', amountUsd: 40 }, // -10 on half
  ]);
  assert.equal(Math.round(r.realizedUsd), 20);
  assert.equal(r.closed, 2);
  assert.equal(r.wins, 1);
  assert.equal(Math.round(r.roiPct!), 20);
  assert.equal(r.openPositions.length, 0);
});

test('open position keeps remaining cost basis', () => {
  const r = computePnl([
    { tokenKey: 's:B', side: 'buy', amountIn: '1', amountOut: '400', amountUsd: 200 },
    { tokenKey: 's:B', side: 'sell', amountIn: '100', amountOut: '1', amountUsd: 75 },
  ]);
  assert.equal(r.openPositions[0].qty, 300n);
  assert.equal(Math.round(r.openPositions[0].costUsd), 150);
  assert.equal(Math.round(r.realizedUsd), 25);
});

test('trenches stages: bonding curve vs DEX-native', () => {
  const base = { migratedAt: null, marketCapUsd: null, liquidityUsd: null, createdAt: new Date() };
  assert.equal(stageFor({ ...base, launchpad: 'pumpfun', bondingPct: 12 }), 'new');
  assert.equal(stageFor({ ...base, launchpad: 'pumpfun', bondingPct: 85 }), 'almost');
  assert.equal(stageFor({ ...base, launchpad: 'pumpfun', bondingPct: 100, migratedAt: new Date() }), 'survived');
  assert.equal(stageFor({ ...base, launchpad: 'clanker', bondingPct: null, marketCapUsd: 50_000 }), 'almost');
  assert.equal(stageFor({ ...base, launchpad: null, bondingPct: null, marketCapUsd: 400_000, liquidityUsd: 60_000 }), 'survived');
});

test('Magura fee tiers by trade size', async () => {
  const { feeBpsFor, MIN_TRADE_USD } = await import('@magura/shared');
  assert.equal(MIN_TRADE_USD, 2);
  assert.throws(() => feeBpsFor('solana', 1.99));
  const cases: [number, number][] = [
    [2, 200], [24.99, 200], [25, 175], [49.99, 175], [50, 150], [99.99, 150], [100, 125], [199.99, 125],
    [200, 100], [499.99, 100], [500, 75], [999.99, 75], [1000, 60], [4999.99, 60], [5000, 40], [9999.99, 40],
    [10000, 25], [24999.99, 25], [25000, 20], [1_000_000, 20],
  ];
  for (const [usd, bps] of cases) {
    assert.equal(feeBpsFor('solana', usd), bps, `solana $${usd}`);
    assert.equal(feeBpsFor('base', usd), bps, `base $${usd}`);
  }
});

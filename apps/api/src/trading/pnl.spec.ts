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

test('coin filters', async () => {
  const { matchesFilter, EMPTY_FILTER, sourceOf, activeFilterCount } = await import('@magura/shared');
  const coin = {
    chain: 'solana' as const, source: 'pumpfun' as const, bonding: 82, ageMin: 12, liquidity: 15000, marketCap: 60000, volume5m: 4000,
    buys5m: 40, sells5m: 12, holders: 310, top10: 22, dev: 3, snipers: null, change1h: 35, chat: 18,
    hasX: true, hasTelegram: false, hasWebsite: true, mintable: false, freezable: false, audited: true, friendsBought: true,
  };
  assert.equal(matchesFilter(coin, EMPTY_FILTER), true);
  assert.equal(matchesFilter(coin, { ...EMPTY_FILTER, chains: ['base'] }), false);
  assert.equal(matchesFilter(coin, { ...EMPTY_FILTER, sources: ['clanker'] }), false);
  assert.equal(matchesFilter(coin, { ...EMPTY_FILTER, sources: ['pumpfun'] }), true);
  assert.equal(matchesFilter(coin, { ...EMPTY_FILTER, hasTelegram: true }), false);
  assert.equal(matchesFilter(coin, { ...EMPTY_FILTER, devUnder20: true, excludeMintable: true, auditedOnly: true }), true);
  assert.equal(matchesFilter(coin, { ...EMPTY_FILTER, ranges: { bonding: { min: 80 }, netBuys5m: { min: 20 } } }), true);
  assert.equal(matchesFilter(coin, { ...EMPTY_FILTER, ranges: { marketCap: { max: 50000 } } }), false);
  // unknown value fails a bound that was set
  assert.equal(matchesFilter(coin, { ...EMPTY_FILTER, ranges: { snipers: { max: 10 } } }), false);
  assert.equal(sourceOf(null, 'pumpswap'), 'pumpswap');
  assert.equal(sourceOf('fourmeme', null), 'fourmeme');
  assert.equal(activeFilterCount({ ...EMPTY_FILTER, hasX: true, ranges: { liquidity: { min: 1 } } }), 2);
});

test('realized PnL books on the day of the sell; streaks skip flat days', async () => {
  const { realizedByDay, streaks } = await import('./pnl');
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  const days = realizedByDay([
    { tokenKey: 'a', side: 'buy', amountIn: '1', amountOut: '100', amountUsd: 100, at: d('2026-11-01') },
    { tokenKey: 'a', side: 'sell', amountIn: '50', amountOut: '1', amountUsd: 80, at: d('2026-11-02') },
    { tokenKey: 'a', side: 'sell', amountIn: '50', amountOut: '1', amountUsd: 40, at: d('2026-11-04') },
  ]);
  assert.equal(days['2026-11-02'], 30);
  assert.equal(days['2026-11-04'], -10);
  assert.deepEqual(streaks({ '2026-11-01': 5, '2026-11-02': 3, '2026-11-05': -1, '2026-11-06': 2 }), { current: 1, best: 2 });
});

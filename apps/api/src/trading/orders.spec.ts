/** Trigger rules for take profit, stop loss, trailing stop and limit buy. Pure — no DB needed. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { shouldFire } from './orders.rules';

const base = { triggerMcUsd: null, entryPrice: 1, peakPrice: 1 };

test('take profit fires at or above +X%', () => {
  const tp = { ...base, kind: 'tp', triggerPct: 100 };
  assert.equal(shouldFire(tp, 1.99, null), false);
  assert.equal(shouldFire(tp, 2, null), true);
});

test('stop loss fires at or below −X%', () => {
  const sl = { ...base, kind: 'sl', triggerPct: -35 };
  assert.equal(shouldFire(sl, 0.66, null), false);
  assert.equal(shouldFire(sl, 0.65, null), true);
});

test('trailing stop follows the peak', () => {
  const tr = { ...base, kind: 'trail', triggerPct: 25, peakPrice: 4 };
  assert.equal(shouldFire(tr, 3.1, null), false); // 22.5% off the 4.0 peak
  assert.equal(shouldFire(tr, 3, null), true); // 25% off
  assert.equal(shouldFire({ ...tr, peakPrice: 1 }, 5, null), false); // new high never fires
});

test('limit buy fires when market cap drops to the target', () => {
  const lb = { ...base, kind: 'limit_buy', triggerPct: null, triggerMcUsd: 45_000 };
  assert.equal(shouldFire(lb, 1, 50_000), false);
  assert.equal(shouldFire(lb, 1, 45_000), true);
  assert.equal(shouldFire(lb, 1, null), false);
});

test('price alerts fire on crossing the target', async () => {
  const { alertHit } = await import('../notifications/price-alerts.rules');
  assert.equal(alertHit({ metric: 'mc', direction: 'above', value: 100_000 }, 1, 99_000), false);
  assert.equal(alertHit({ metric: 'mc', direction: 'above', value: 100_000 }, 1, 100_000), true);
  assert.equal(alertHit({ metric: 'price', direction: 'below', value: 0.5 }, 0.49, null), true);
  assert.equal(alertHit({ metric: 'price', direction: 'below', value: 0.5 }, null, null), false);
});

test('trailing take profit arms at +X% then sells on a Y% pullback from the peak', async () => {
  const { shouldArm } = await import('./orders.rules');
  const o = { ...base, kind: 'trail_tp', triggerPct: 20, armPct: 100, armed: false };
  assert.equal(shouldArm(o, 1.5), false);
  assert.equal(shouldArm(o, 2), true);
  assert.equal(shouldFire({ ...o, armed: false }, 0.5, null), false); // never fires before arming
  const armed = { ...o, armed: true, peakPrice: 3 };
  assert.equal(shouldFire(armed, 2.5, null), false);
  assert.equal(shouldFire(armed, 2.4, null), true);
});

test('DCA fires on schedule, only inside the market-cap band, until all slices are bought', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const o = { ...base, kind: 'dca', triggerPct: null, nextAt: new Date('2026-11-06T11:59:00Z'), slicesDone: 1, slicesTotal: 4, minMcUsd: 50_000, triggerMcUsd: 200_000 };
  assert.equal(shouldFire(o, 1, 100_000, now), true);
  assert.equal(shouldFire(o, 1, 40_000, now), false);
  assert.equal(shouldFire(o, 1, 300_000, now), false);
  assert.equal(shouldFire({ ...o, nextAt: new Date('2026-11-06T12:05:00Z') }, 1, 100_000, now), false);
  assert.equal(shouldFire({ ...o, slicesDone: 4 }, 1, 100_000, now), false);
});

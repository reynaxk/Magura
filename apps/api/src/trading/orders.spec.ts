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

/** Cashback tiers and the competition week. Pure — no DB needed. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cashbackTierFor } from '@magura/shared';

test('cashback tier follows 30-day volume', () => {
  assert.equal(cashbackTierFor(0).tier.pct, 0);
  assert.equal(cashbackTierFor(999).tier.name, 'Scout');
  assert.equal(cashbackTierFor(1_000).tier.pct, 10);
  assert.equal(cashbackTierFor(60_000).tier.name, 'Predator');
  assert.equal(cashbackTierFor(1e9).tier.pct, 50);
  assert.equal(cashbackTierFor(1e9).next, null);
});

test('competition week starts Monday 00:00 UTC', async () => {
  const { weekStart } = await import('./week');
  assert.equal(weekStart(new Date('2026-11-05T15:00:00Z')).toISOString(), '2026-11-02T00:00:00.000Z'); // Thu → Mon
  assert.equal(weekStart(new Date('2026-11-08T23:59:00Z')).toISOString(), '2026-11-02T00:00:00.000Z'); // Sun
  assert.equal(weekStart(new Date('2026-11-09T00:00:00Z')).toISOString(), '2026-11-09T00:00:00.000Z'); // Mon
});

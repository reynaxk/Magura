/** Wallet copy decisions — pure. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { copyDecision } from './wallet-copy.rules';

const base = { buyMode: 'fixed', buyAmount: '0.2', ratioPct: null, sellMode: 'copy', minMcUsd: null, maxMcUsd: null, maxAgeMin: null, buyOnce: true, skipAddOn: true, blacklist: [] as string[] };
const buy = { side: 'buy' as const, native: 3, tokens: 1_000_000, prevBal: 0, firstBuy: true, mint: 'M' };
const coin = { marketCapUsd: 20_000, ageMin: 5 };

test('fixed buy copies their first entry', () => {
  assert.deepEqual(copyDecision(base, buy, coin, false), { action: 'buy', amount: '0.2' });
});

test('ratio buy follows their size, capped', () => {
  assert.deepEqual(copyDecision({ ...base, buyMode: 'ratio', ratioPct: 10, buyAmount: '1' }, buy, coin, false), { action: 'buy', amount: '0.3' });
  assert.deepEqual(copyDecision({ ...base, buyMode: 'ratio', ratioPct: 50, buyAmount: '1' }, buy, coin, false), { action: 'buy', amount: '1' });
});

test('filters: add-ons, buy once, market cap, age, blacklist', () => {
  assert.equal(copyDecision(base, { ...buy, firstBuy: false }, coin, false).action, 'skip');
  assert.equal(copyDecision(base, buy, coin, true).action, 'skip');
  assert.deepEqual(copyDecision({ ...base, maxMcUsd: 10_000 }, buy, coin, false), { action: 'skip', reason: 'mc_high' });
  assert.deepEqual(copyDecision({ ...base, minMcUsd: 50_000 }, buy, coin, false), { action: 'skip', reason: 'mc_low' });
  assert.deepEqual(copyDecision({ ...base, maxAgeMin: 2 }, buy, coin, false), { action: 'skip', reason: 'too_old' });
  assert.deepEqual(copyDecision({ ...base, blacklist: ['M'] }, buy, coin, false), { action: 'skip', reason: 'blacklisted' });
});

test('sells copy the share they sold; nothing to sell without a copied buy', () => {
  const sell = { side: 'sell' as const, native: 1, tokens: 250_000, prevBal: 1_000_000, firstBuy: false, mint: 'M' };
  assert.deepEqual(copyDecision(base, sell, coin, true), { action: 'sell', pct: 25 });
  assert.deepEqual(copyDecision(base, { ...sell, tokens: 990_000 }, coin, true), { action: 'sell', pct: 100 });
  assert.equal(copyDecision(base, sell, coin, false).action, 'skip');
  assert.equal(copyDecision({ ...base, sellMode: 'none' }, sell, coin, true).action, 'skip');
});

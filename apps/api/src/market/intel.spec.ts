/** Holder intelligence: ledger, tags and supply split. Pure — no DB. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyTrade, computeIntel, holderRows, sortHolders, tagsFor, type LedgerEntry } from '@magura/shared';

const SUPPLY = 1_000_000_000;

function build(trades: [wallet: string, side: 'buy' | 'sell', tokens: number, sol: number, ms: number][]) {
  const ledger: Record<string, LedgerEntry> = {};
  let rank = 0;
  for (const [w, side, tokens, sol, ms] of trades) {
    if (side === 'buy' && !(w in ledger) && w !== 'DEV') rank++;
    ledger[w] = applyTrade(ledger[w] ?? null, { wallet: w, side, tokenAmount: tokens, nativeAmount: sol }, ms, rank);
  }
  return ledger;
}

test('dev, bundler, sniper and early tags come from entry timing', () => {
  const l = build([
    ['DEV', 'buy', 50_000_000, 1.5, 0],
    ['B1', 'buy', 30_000_000, 1, 300],
    ['S1', 'buy', 20_000_000, 0.7, 3_000],
    ['LATE', 'buy', 10_000_000, 0.5, 60_000],
  ]);
  assert.deepEqual(tagsFor('DEV', l.DEV, 'DEV', SUPPLY), ['dev']);
  assert.ok(tagsFor('B1', l.B1, 'DEV', SUPPLY).includes('bundler'));
  assert.ok(tagsFor('S1', l.S1, 'DEV', SUPPLY).includes('sniper'));
  assert.ok(!tagsFor('LATE', l.LATE, 'DEV', SUPPLY).includes('sniper'));
  assert.ok(tagsFor('LATE', l.LATE, 'DEV', SUPPLY).includes('early'));
});

test('supply split and dev sold all', () => {
  const l = build([
    ['DEV', 'buy', 50_000_000, 1.5, 0],
    ['B1', 'buy', 30_000_000, 1, 300],
    ['S1', 'buy', 20_000_000, 0.7, 3_000],
    ['DEV', 'sell', 50_000_000, 1.6, 90_000],
  ]);
  const i = computeIntel(l, 'DEV', SUPPLY);
  assert.equal(i.holders, 2);
  assert.equal(i.devPct, 0);
  assert.equal(i.devSoldAll, true);
  assert.equal(i.devSoldPct, 100);
  assert.equal(i.bundlerPct, 3);
  assert.equal(i.sniperPct, 2);
  assert.equal(i.top10Pct, 5);
});

test('fresh early buyer counts as insider', () => {
  const l = build([['F', 'buy', 10_000_000, 0.3, 8_000]]);
  l.F.fresh = true;
  assert.ok(tagsFor('F', l.F, 'DEV', SUPPLY).includes('insider'));
  assert.equal(computeIntel(l, 'DEV', SUPPLY).insiderPct, 1);
});

test('balanceAfter from the feed wins over our running sum', () => {
  const e = applyTrade(null, { wallet: 'A', side: 'buy', tokenAmount: 100, nativeAmount: 1, balanceAfter: 250 }, 10, 1);
  assert.equal(e.bal, 250);
});

test('holder rows: realized + unrealized PnL', () => {
  const l = build([
    ['A', 'buy', 100, 1, 10_000],
    ['A', 'sell', 50, 1, 20_000],
  ]);
  const [row] = holderRows(l, null, 1000, 0.02);
  assert.equal(row.realizedNative, 0.5); // sold half for 1, cost basis 0.5
  assert.equal(row.unrealizedNative, 0.5); // 50 left worth 1, cost 0.5
  assert.equal(sortHolders([row], 'holding').length, 1);
});

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

test('pump.fun TradeEvent log decodes', async () => {
  const { createHash } = await import('node:crypto');
  const { decodePumpTrade } = await import('@magura/chains');
  const b = Buffer.alloc(8 + 32 + 8 + 8 + 1 + 32 + 8 + 16);
  createHash('sha256').update('event:TradeEvent').digest().copy(b, 0, 0, 8);
  b.fill(7, 8, 40); // mint
  b.writeBigUInt64LE(1_500_000_000n, 40); // 1.5 SOL
  b.writeBigUInt64LE(42_000_000_000n, 48); // 42,000 tokens
  b[56] = 1; // buy
  b.fill(9, 57, 89); // user
  b.writeBigInt64LE(1_790_000_000n, 89);
  const t = decodePumpTrade(b.toString('base64'));
  assert.ok(t);
  assert.equal(t.side, 'buy');
  assert.equal(t.solAmount, 1.5);
  assert.equal(t.tokenAmount, 42_000);
  assert.equal(t.at.getTime(), 1_790_000_000_000);
  assert.notEqual(t.mint, t.wallet);
  assert.equal(decodePumpTrade(Buffer.alloc(120).toString('base64')), null);
});

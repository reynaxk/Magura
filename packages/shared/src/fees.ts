import { CHAINS, type ChainId } from './chains';

/**
 * Magura platform fee — tiered by trade size in USD (same on every chain).
 *
 *   $2 – 24.99          2.00%
 *   $25 – 49.99         1.75%
 *   $50 – 99.99         1.50%
 *   $100 – 199.99       1.25%
 *   $200 – 499.99       1.00%
 *   $500 – 999.99       0.75%
 *   $1,000 – 4,999.99   0.60%
 *   $5,000 – 9,999.99   0.40%
 *   $10,000 – 24,999.99 0.25%
 *   $25,000+            0.20%
 *
 * Trades under $2 are rejected. Users always pay their own gas (no sponsorship).
 * Fees are charged in the chain's native coin (SOL / ETH / BNB).
 */
export const MIN_TRADE_USD = 2;

export interface FeeTier {
  /** inclusive lower bound in USD */
  fromUsd: number;
  /** exclusive upper bound in USD (null = no cap) */
  toUsd: number | null;
  svmBps: number;
  evmBps: number;
}

const tier = (fromUsd: number, toUsd: number | null, bps: number): FeeTier => ({ fromUsd, toUsd, svmBps: bps, evmBps: bps });

export const FEE_TIERS: FeeTier[] = [
  tier(2, 25, 200),
  tier(25, 50, 175),
  tier(50, 100, 150),
  tier(100, 200, 125),
  tier(200, 500, 100),
  tier(500, 1_000, 75),
  tier(1_000, 5_000, 60),
  tier(5_000, 10_000, 40),
  tier(10_000, 25_000, 25),
  tier(25_000, null, 20),
];

export class TradeTooSmallError extends Error {
  constructor(public readonly usd: number) {
    super(`min_trade_${MIN_TRADE_USD}_usd`);
  }
}

export function feeTierFor(usd: number): FeeTier {
  if (!Number.isFinite(usd) || usd < MIN_TRADE_USD) throw new TradeTooSmallError(usd);
  return FEE_TIERS.find((t) => usd >= t.fromUsd && (t.toUsd == null || usd < t.toUsd))!;
}

/** Fee in basis points for a trade of `usd` on `chain`. */
export function feeBpsFor(chain: ChainId, usd: number): number {
  const tier = feeTierFor(usd);
  return CHAINS[chain].kind === 'svm' ? tier.svmBps : tier.evmBps;
}

/** Next cheaper tier, for "trade $X+ to pay Y%" hints. */
export function nextTier(chain: ChainId, usd: number): { atUsd: number; bps: number } | null {
  const i = FEE_TIERS.findIndex((t) => usd >= t.fromUsd && (t.toUsd == null || usd < t.toUsd));
  const next = i >= 0 ? FEE_TIERS[i + 1] : FEE_TIERS[0];
  if (!next) return null;
  return { atUsd: next.fromUsd, bps: CHAINS[chain].kind === 'svm' ? next.svmBps : next.evmBps };
}

export function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2).replace(/0$/, '')}%`;
}

/**
 * Native coin kept back for network gas. Buys can't spend into it, and copy
 * trades check it before executing. Users pay their own gas — Magura never sponsors it.
 */
export const GAS_RESERVE: Record<ChainId, { human: string; base: string }> = {
  solana: { human: '0.01', base: '10000000' }, // 0.01 SOL
  base: { human: '0.0003', base: '300000000000000' }, // 0.0003 ETH
  bsc: { human: '0.002', base: '2000000000000000' }, // 0.002 BNB
  ethereum: { human: '0.004', base: '4000000000000000' }, // 0.004 ETH
};

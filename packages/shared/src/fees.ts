import { CHAINS, type ChainId } from './chains';

/**
 * Magura platform fee — tiered by trade size in USD.
 *
 *   $2 – 99.99    1%      ("never more than 1%")
 *   $100 – 499.99 0.85%
 *   $500+         0.75%
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

export const FEE_TIERS: FeeTier[] = [
  { fromUsd: 2, toUsd: 100, svmBps: 100, evmBps: 100 },
  { fromUsd: 100, toUsd: 500, svmBps: 85, evmBps: 85 },
  { fromUsd: 500, toUsd: null, svmBps: 75, evmBps: 75 },
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

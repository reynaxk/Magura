import type { WalletCopy } from '@magura/db';
import type { WalletFill } from '../market/intel.service';

/** Pure: should this copy act on this fill, and with what size? Unit tested. */
export function copyDecision(
  c: Pick<WalletCopy, 'buyMode' | 'buyAmount' | 'ratioPct' | 'sellMode' | 'minMcUsd' | 'maxMcUsd' | 'maxAgeMin' | 'buyOnce' | 'skipAddOn' | 'blacklist'>,
  f: Pick<WalletFill, 'side' | 'native' | 'tokens' | 'prevBal' | 'firstBuy' | 'mint'>,
  coin: { marketCapUsd: number | null; ageMin: number | null },
  boughtBefore: boolean,
): { action: 'buy'; amount: string } | { action: 'sell'; pct: number } | { action: 'skip'; reason: string } {
  if (c.blacklist.includes(f.mint)) return { action: 'skip', reason: 'blacklisted' };
  if (f.side === 'sell') {
    if (c.sellMode !== 'copy') return { action: 'skip', reason: 'sells_off' };
    if (!boughtBefore) return { action: 'skip', reason: 'no_position' };
    const pct = f.prevBal > 0 ? Math.round(Math.min(1, f.tokens / f.prevBal) * 100) : 100;
    return { action: 'sell', pct: Math.max(1, pct >= 95 ? 100 : pct) };
  }
  if (c.skipAddOn && !f.firstBuy) return { action: 'skip', reason: 'add_on' };
  if (c.buyOnce && boughtBefore) return { action: 'skip', reason: 'already_bought' };
  if (c.minMcUsd != null && (coin.marketCapUsd == null || coin.marketCapUsd < c.minMcUsd)) return { action: 'skip', reason: 'mc_low' };
  if (c.maxMcUsd != null && (coin.marketCapUsd == null || coin.marketCapUsd > c.maxMcUsd)) return { action: 'skip', reason: 'mc_high' };
  if (c.maxAgeMin != null && (coin.ageMin == null || coin.ageMin > c.maxAgeMin)) return { action: 'skip', reason: 'too_old' };
  const cap = Number(c.buyAmount);
  const size = c.buyMode === 'ratio' && c.ratioPct ? Math.min(cap, (f.native * c.ratioPct) / 100) : cap;
  if (!(size > 0.0001)) return { action: 'skip', reason: 'too_small' };
  return { action: 'buy', amount: String(Math.round(size * 10_000) / 10_000) };
}


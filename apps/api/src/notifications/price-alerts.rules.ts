import type { PriceAlert } from '@magura/db';

/** Pure: has this alert's condition been met? */
export function alertHit(a: Pick<PriceAlert, 'metric' | 'direction' | 'value'>, priceUsd: number | null, mcUsd: number | null): boolean {
  const v = a.metric === 'mc' ? mcUsd : priceUsd;
  if (v == null) return false;
  return a.direction === 'above' ? v >= a.value : v <= a.value;
}

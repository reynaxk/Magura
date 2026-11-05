import type { OrderRule } from '@magura/db';

/** When a take profit, stop loss, trailing stop or limit buy should fire. Pure — unit tested. */
export function shouldFire(o: Pick<OrderRule, 'kind' | 'triggerPct' | 'triggerMcUsd' | 'entryPrice' | 'peakPrice'>, price: number, mcUsd: number | null): boolean {
  if (o.kind === 'limit_buy') return mcUsd != null && o.triggerMcUsd != null && mcUsd <= o.triggerMcUsd;
  if (o.entryPrice == null || o.triggerPct == null) return false;
  if (o.kind === 'tp') return price >= o.entryPrice * (1 + o.triggerPct / 100);
  if (o.kind === 'sl') return price <= o.entryPrice * (1 + o.triggerPct / 100);
  if (o.kind === 'trail') {
    const peak = Math.max(o.peakPrice ?? o.entryPrice, price);
    return price <= peak * (1 - o.triggerPct / 100);
  }
  return false;
}


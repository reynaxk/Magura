import type { OrderRule } from '@magura/db';

type RuleView = Pick<OrderRule, 'kind' | 'triggerPct' | 'triggerMcUsd' | 'entryPrice' | 'peakPrice'> &
  Partial<Pick<OrderRule, 'armPct' | 'armed' | 'nextAt' | 'minMcUsd' | 'slicesDone' | 'slicesTotal'>>;

/** Kinds fired by events (dev sold, coin migrated) instead of price. */
export const EVENT_KINDS = ['dev_sell', 'dev_sell_buy', 'migrate_buy', 'migrate_sell', 'dev_snipe', 'copy_buy', 'copy_sell'] as const;
export const BUY_KINDS = ['limit_buy', 'dca', 'dev_sell_buy', 'migrate_buy', 'dev_snipe', 'copy_buy'] as const;

/** When a price-driven order should fire. Pure — unit tested. */
export function shouldFire(o: RuleView, price: number, mcUsd: number | null, now = new Date()): boolean {
  if (o.kind === 'limit_buy') return mcUsd != null && o.triggerMcUsd != null && mcUsd <= o.triggerMcUsd;
  if (o.kind === 'dca') {
    if (!o.nextAt || now < o.nextAt) return false;
    if ((o.slicesDone ?? 0) >= (o.slicesTotal ?? 0)) return false;
    // optional market-cap band: skip this slot when outside it
    if (o.minMcUsd != null && (mcUsd == null || mcUsd < o.minMcUsd)) return false;
    if (o.triggerMcUsd != null && (mcUsd == null || mcUsd > o.triggerMcUsd)) return false;
    return true;
  }
  if (o.entryPrice == null || o.triggerPct == null) return false;
  if (o.kind === 'tp') return price >= o.entryPrice * (1 + o.triggerPct / 100);
  if (o.kind === 'sl') return price <= o.entryPrice * (1 + o.triggerPct / 100);
  if (o.kind === 'trail') {
    const peak = Math.max(o.peakPrice ?? o.entryPrice, price);
    return price <= peak * (1 - o.triggerPct / 100);
  }
  if (o.kind === 'trail_tp') {
    if (!o.armed) return false;
    const peak = Math.max(o.peakPrice ?? o.entryPrice, price);
    return price <= peak * (1 - o.triggerPct / 100);
  }
  return false;
}

/** trail_tp arms once the price has run up armPct from entry. */
export function shouldArm(o: RuleView, price: number): boolean {
  return o.kind === 'trail_tp' && !o.armed && o.entryPrice != null && o.armPct != null && price >= o.entryPrice * (1 + o.armPct / 100);
}

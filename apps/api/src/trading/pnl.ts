/**
 * Spot PnL from a trade log. Quantities are compared within the same token,
 * so base units never need converting.
 */
export interface PnlTrade {
  tokenKey: string; // chain:address
  side: 'buy' | 'sell';
  amountIn: string;
  amountOut: string;
  amountUsd: number;
}

export interface PnlSummary {
  costUsd: number; // cost basis of everything sold
  realizedUsd: number;
  roiPct: number | null;
  closed: number;
  wins: number;
  winRatePct: number | null;
  openPositions: { tokenKey: string; qty: bigint; costUsd: number }[];
}

export function computePnl(trades: PnlTrade[]): PnlSummary {
  const pos = new Map<string, { qty: bigint; cost: number }>();
  let costUsd = 0;
  let realizedUsd = 0;
  let closed = 0;
  let wins = 0;
  for (const t of trades) {
    const p = pos.get(t.tokenKey) ?? { qty: 0n, cost: 0 };
    if (t.side === 'buy') {
      p.qty += BigInt(t.amountOut || '0');
      p.cost += t.amountUsd;
    } else {
      const sold = BigInt(t.amountIn || '0');
      if (p.qty > 0n && sold > 0n) {
        const frac = Number(sold >= p.qty ? 1 : Number((sold * 1_000_000n) / p.qty) / 1_000_000);
        const basis = p.cost * frac;
        const pnl = t.amountUsd - basis;
        costUsd += basis;
        realizedUsd += pnl;
        closed++;
        if (pnl > 0) wins++;
        p.cost -= basis;
        p.qty = sold >= p.qty ? 0n : p.qty - sold;
      }
    }
    pos.set(t.tokenKey, p);
  }
  return {
    costUsd,
    realizedUsd,
    roiPct: costUsd > 0 ? (realizedUsd / costUsd) * 100 : null,
    closed,
    wins,
    winRatePct: closed ? (wins / closed) * 100 : null,
    openPositions: [...pos.entries()].filter(([, v]) => v.qty > 0n).map(([tokenKey, v]) => ({ tokenKey, qty: v.qty, costUsd: v.cost })),
  };
}

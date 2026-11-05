export interface PnlCardData {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  chain: string;
  token: string;
  symbol: string;
  investedUsd: number;
  returnedUsd: number;
  openValueUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
  holding: boolean;
  heldMs: number;
}

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magura.app';

export function heldFor(ms: number) {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

export const pctText = (p: number | null) => (p == null ? '—' : `${p >= 0 ? '+' : '−'}${Math.abs(p) >= 1000 ? Math.round(Math.abs(p)).toLocaleString('en-US') : Math.abs(p).toFixed(Math.abs(p) >= 100 ? 0 : 1)}%`);
export const usdText = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function fmtUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (opts.compact !== false && Math.abs(n) >= 1000) {
    const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, u] of units) if (Math.abs(n) >= v) return `$${(n / v).toFixed(n / v >= 100 ? 0 : 1)}${u}`;
  }
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toPrecision(3)}`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (n === 0) return '0';
  // 0.0000123 -> 0.0₄123 style is nice but keep it simple and readable
  return n.toPrecision(4);
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function fmtAge(iso: string | Date, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function shortAddr(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

/** Convert a human amount (e.g. "0.5") to base units string without float error. */
export function toBaseUnits(amount: string, decimals: number): string {
  const [whole, frac = ''] = amount.trim().split('.');
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) throw new Error('Invalid amount');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const s = `${whole || '0'}${padded}`.replace(/^0+(?=\d)/, '');
  return s === '' ? '0' : s;
}

export function fromBaseUnits(amount: string | bigint, decimals: number): number {
  const s = amount.toString().padStart(decimals + 1, '0');
  return Number(`${s.slice(0, -decimals) || '0'}.${s.slice(-decimals)}`);
}

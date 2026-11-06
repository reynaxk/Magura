'use client';

import { tagMeta, type TokenIntel, type TokenRisk } from '@magura/shared';

/** Horizontal bars: how much of the supply each wallet type holds. */
export function SupplySplit({ intel, risk, compact }: { intel: TokenIntel | null | undefined; risk?: TokenRisk | null; compact?: boolean }) {
  const rows: { label: string; color: string; pct: number | null | undefined; count?: number }[] = [
    { label: 'Top 10', color: '#8B9CFF', pct: intel?.top10Pct ?? risk?.top10Pct },
    { label: 'Dev', color: tagMeta('dev').color, pct: intel?.devPct ?? risk?.devPct },
    { label: 'Snipers', color: tagMeta('sniper').color, pct: intel?.sniperPct ?? risk?.sniperPct, count: intel?.snipers },
    { label: 'Bundlers', color: tagMeta('bundler').color, pct: intel?.bundlerPct, count: intel?.bundlers },
    { label: 'Insiders', color: tagMeta('insider').color, pct: intel?.insiderPct, count: intel?.insiders },
    { label: 'Fresh', color: tagMeta('fresh').color, pct: intel?.freshPct, count: intel?.fresh },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Who holds</span>
        {intel && (
          <span className="num ml-auto text-[11px] text-muted">
            <span className="text-text">{intel.holders}</span> holders
          </span>
        )}
      </div>
      {rows.map((r) => (
        <div key={r.label} className={`grid grid-cols-[64px_1fr_44px] items-center gap-2 ${compact ? 'text-[11px]' : 'text-xs'}`}>
          <span className="text-text-2">
            {r.label}
            {r.count ? <span className="num text-faint"> ·{r.count}</span> : null}
          </span>
          <span className="h-[6px] overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.pct ?? 0)}%`, background: r.color, opacity: r.pct == null ? 0 : 1 }} />
          </span>
          <span className="num text-right text-text">{r.pct == null ? '—' : `${r.pct.toFixed(1)}%`}</span>
        </div>
      ))}
      {intel && (intel.devSoldAll || intel.devSoldPct > 0) && (
        <p className={`rounded-lg px-2.5 py-1.5 text-[11px] ${intel.devSoldAll ? 'bg-down-dim text-down-2' : 'bg-raised text-amber'}`}>
          {intel.devSoldAll ? 'The dev sold everything.' : `The dev sold ${intel.devSoldPct}% of their bag.`}
        </p>
      )}
    </div>
  );
}

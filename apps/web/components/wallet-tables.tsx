'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHAINS, WALLET_TAGS, fmtAge, fmtUsd, tagMeta, type ChainId, type HolderRow, type HolderSort, type TokenIntel, type WalletTag } from '@magura/shared';
import { api } from '@/lib/api';
import { Avatar, Empty, Icon } from './ui';
import { DevSnipe } from './orders';

interface WalletsResponse {
  rows: HolderRow[] | null;
  nativeUsd: number | null;
  intel: TokenIntel | null;
  creator: string | null;
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const FILTER_TAGS: (WalletTag | 'all')[] = ['all', 'smart', 'dev', 'sniper', 'bundler', 'insider', 'fresh', 'whale', 'early', 'magura'];

export function TagPill({ tag }: { tag: WalletTag }) {
  const m = tagMeta(tag);
  return (
    <span title={m.hint} className="num rounded-[5px] border px-1 text-[9.5px] font-bold tracking-wide" style={{ color: m.color, borderColor: `${m.color}44`, background: `${m.color}12` }}>
      {m.short}
    </span>
  );
}

function Native({ v, sym, usd, signed }: { v: number | null; sym: string; usd: number | null; signed?: boolean }) {
  if (v == null) return <span className="text-faint">—</span>;
  const tone = signed ? (v > 0 ? 'text-lime' : v < 0 ? 'text-down-2' : 'text-text-2') : 'text-text';
  const sign = signed && v > 0 ? '+' : '';
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={`num ${tone}`}>
        {sign}
        {Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3)} <span className="text-faint">{sym}</span>
      </span>
      {usd != null && (
        <span className="num text-[10px] text-faint">
          {sign}
          {fmtUsd(v * usd)}
        </span>
      )}
    </span>
  );
}

const entry = (ms: number | null) => (ms == null ? '—' : ms < 1000 ? `+${ms}ms` : ms < 60_000 ? `+${(ms / 1000).toFixed(1)}s` : ms < 3600_000 ? `+${Math.round(ms / 60_000)}m` : `+${(ms / 3600_000).toFixed(1)}h`);

/**
 * Holders / Top traders / Early buyers built from Magura's launch ledger.
 * Returns `fallback` for coins we didn't see launch (older DEX coins).
 */
export function WalletTable({ chain, address, sort, fallback }: { chain: ChainId; address: string; sort: HolderSort; fallback: React.ReactNode }) {
  const [tag, setTag] = useState<WalletTag | 'all'>('all');
  const q = useQuery({
    queryKey: ['coin-wallets', chain, address, sort, tag],
    queryFn: () => api<WalletsResponse>(`/market/tokens/${chain}/${address}/wallets?sort=${sort}${tag !== 'all' ? `&tag=${tag}` : ''}`),
    refetchInterval: 10_000,
  });
  const sym = CHAINS[chain].nativeSymbol;
  if (q.data && q.data.rows === null) return <>{fallback}</>;
  const rows = q.data?.rows ?? [];
  const usd = q.data?.nativeUsd ?? null;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="scroll-thin flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2">
        {FILTER_TAGS.map((t) => {
          const on = tag === t;
          const m = t === 'all' ? null : tagMeta(t);
          return (
            <button
              key={t}
              onClick={() => setTag(t)}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold"
              style={{ borderColor: on ? (m?.color ?? '#2FE39A') + '66' : '#1F232B', background: on ? (m?.color ?? '#2FE39A') + '14' : 'transparent', color: on ? '#E9ECF2' : '#7A8397' }}
            >
              {m && <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />}
              {t === 'all' ? 'All' : m!.label}
            </button>
          );
        })}
      </div>
      <div className="scroll-thin max-h-[380px] overflow-auto">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr className="label text-left">
              <th className="py-2 pl-4 font-medium">#</th>
              <th className="px-2 font-medium">Wallet</th>
              <th className="px-2 text-right font-medium">Bought</th>
              <th className="px-2 text-right font-medium">Sold</th>
              <th className="px-2 text-right font-medium">{sort === 'pnl' ? 'Realized' : 'PnL'}</th>
              <th className="px-2 text-right font-medium">Holds</th>
              <th className="pr-4 text-right font-medium">Entry</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.wallet} className="group h-10 border-t border-[#151820] hover:bg-hover">
                <td className="num pl-4 text-faint">{sort === 'early' && r.rank ? r.rank : i + 1}</td>
                <td className="px-2">
                  <span className="flex items-center gap-1.5">
                    {r.handle ? (
                      <Link href={`/u/${r.handle}`} className="flex items-center gap-1.5 text-text hover:text-lime">
                        <Avatar name={r.handle} size={18} shape="circle" />@{r.handle}
                      </Link>
                    ) : (
                      <Link href={`/w/${chain}/${r.wallet}`} className="num text-text-2 hover:text-lime">
                        {short(r.wallet)}
                      </Link>
                    )}
                    {r.tags.filter((t) => t !== 'magura').map((t) => (
                      <TagPill key={t} tag={t} />
                    ))}
                    <span className="num text-[10px] text-faint">
                      {r.buys}/{r.sells}
                    </span>
                  </span>
                </td>
                <td className="px-2 text-right">
                  <Native v={r.boughtNative} sym={sym} usd={usd} />
                </td>
                <td className="px-2 text-right">
                  <Native v={r.soldNative || null} sym={sym} usd={usd} />
                </td>
                <td className="px-2 text-right">
                  <Native v={sort === 'pnl' ? r.realizedNative : (r.pnlNative ?? r.realizedNative)} sym={sym} usd={usd} signed />
                </td>
                <td className="px-2 text-right">
                  {r.balance > 0 ? (
                    <span className="flex items-center justify-end gap-2">
                      <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-line-2 sm:block">
                        <span className="block h-full bg-text-2" style={{ width: `${Math.min(100, (r.pctSupply ?? 0) * 5)}%` }} />
                      </span>
                      <span className="num w-12">{r.pctSupply != null ? `${r.pctSupply.toFixed(2)}%` : '—'}</span>
                    </span>
                  ) : (
                    <span className="num text-[11px] text-faint">sold</span>
                  )}
                </td>
                <td className="num pr-4 text-right text-text-2">{entry(r.firstMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.isLoading && <p className="p-4 text-sm text-muted">Loading wallets…</p>}
        {!q.isLoading && rows.length === 0 && <Empty icon={Icon.globe} title={tag === 'all' ? 'No wallets yet' : `No ${tagMeta(tag as WalletTag).label.toLowerCase()} wallets`} />}
      </div>
    </div>
  );
}

interface DevReport {
  creator: string;
  launched: number;
  migrated: number;
  migratedPct: number;
  quickRugs: number;
  best: { address: string; symbol: string; athMarketCapUsd: number | null } | null;
  lastLaunchAt: string | null;
  tokens: { address: string; symbol: string; name: string; imageUrl: string | null; createdAt: string; migrated: boolean; marketCapUsd: number | null; athMarketCapUsd: number | null; devSold: boolean }[];
}

/** Dev tab: who made this coin and how their other coins went. */
export function DevReportCard({ chain, creator }: { chain: ChainId; creator: string | null }) {
  const q = useQuery({
    queryKey: ['dev-report', chain, creator],
    queryFn: () => api<DevReport>(`/market/dev/${chain}/${creator}`),
    enabled: !!creator,
    staleTime: 30_000,
  });
  if (!creator) return <Empty icon={Icon.globe} title="Dev unknown">We only know the creator for coins that launched on a launchpad we watch.</Empty>;
  const d = q.data;
  const verdict = !d ? null : d.quickRugs >= 2 ? { t: 'Serial dumper', c: 'text-down-2 bg-down-dim' } : d.migratedPct >= 30 && d.launched >= 2 ? { t: 'Ships coins that bond', c: 'text-lime bg-lime-dim' } : d.launched >= 5 ? { t: 'Launches a lot', c: 'text-amber bg-raised' } : { t: 'New dev', c: 'text-text-2 bg-raised' };
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`${CHAINS[chain].explorer}/account/${creator}`} target="_blank" rel="noreferrer" className="num text-sm text-text hover:text-lime">
          {short(creator)}
        </a>
        <TagPill tag="dev" />
        {verdict && <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${verdict.c}`}>{verdict.t}</span>}
      </div>
      <DevSnipe chain={chain} creator={creator} />
      <div className="num grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Launched', d?.launched ?? '—'],
          ['Bonded', d ? `${d.migrated} · ${d.migratedPct}%` : '—'],
          ['Sold in 1st hour', d?.quickRugs ?? '—'],
          ['Best ATH', d?.best?.athMarketCapUsd ? `${fmtUsd(d.best.athMarketCapUsd)} $${d.best.symbol}` : '—'],
        ].map(([k, v]) => (
          <div key={k as string} className="flex flex-col gap-0.5 rounded-xl bg-raised p-2.5">
            <span className="text-[10.5px] text-muted">{k}</span>
            <span className="truncate text-[13px]">{v}</span>
          </div>
        ))}
      </div>
      <div className="scroll-thin max-h-[260px] overflow-auto rounded-xl border border-line">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-panel">
            <tr className="label text-left">
              <th className="py-2 pl-3 font-medium">Coin</th>
              <th className="px-2 text-right font-medium">ATH</th>
              <th className="px-2 text-right font-medium">Now</th>
              <th className="pr-3 text-right font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {(d?.tokens ?? []).map((t) => (
              <tr key={t.address} className="h-9 border-t border-[#151820] hover:bg-hover">
                <td className="pl-3">
                  <Link href={`/t/${chain}/${t.address}`} className="flex items-center gap-2">
                    <Avatar name={t.symbol} src={t.imageUrl} size={20} />
                    <span className="font-semibold">{t.symbol}</span>
                    {t.migrated && <span className="rounded bg-lime-dim px-1 text-[9.5px] font-bold text-lime">BONDED</span>}
                    {t.devSold && <span className="rounded bg-down-dim px-1 text-[9.5px] font-bold text-down-2">DEV SOLD</span>}
                  </Link>
                </td>
                <td className="num px-2 text-right">{fmtUsd(t.athMarketCapUsd)}</td>
                <td className="num px-2 text-right text-text-2">{fmtUsd(t.marketCapUsd)}</td>
                <td className="num pr-3 text-right text-faint">{fmtAge(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { WALLET_TAGS };

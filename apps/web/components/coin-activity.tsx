'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHAINS, fmtAge, fmtUsd, type ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from './toaster';
import { Empty, Icon } from './ui';

type Tag = 'you' | 'magura' | 'following' | 'tracked' | 'dev' | 'early' | 'pool' | 'locked';
interface CoinTrade {
  side: 'buy' | 'sell';
  wallet: string;
  usd: number | null;
  mcUsd: number | null;
  at: string;
  txHash: string;
  tags: Tag[];
  name: string | null;
}
interface CoinHolder {
  address: string;
  pct: number;
  tags: Tag[];
  name: string | null;
}

const TAG: Record<Tag, { label: string; cls: string }> = {
  you: { label: 'You', cls: 'border-lime-line text-lime' },
  following: { label: 'Following', cls: 'border-lime-line text-lime' },
  magura: { label: 'Magura', cls: 'border-line-3 text-text' },
  tracked: { label: 'Tracked', cls: 'border-line-3 text-text' },
  dev: { label: 'Dev', cls: 'border-[#4A3A1E] text-amber' },
  early: { label: 'Early', cls: 'border-down-line text-down-2' },
  pool: { label: 'Pool', cls: 'border-line-2 text-muted' },
  locked: { label: 'Locked', cls: 'border-line-2 text-muted' },
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'magura', label: 'Magura' },
  { id: 'following', label: 'Following' },
  { id: 'tracked', label: 'Tracked' },
  { id: 'dev', label: 'Dev' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-3)}` : a);

function Tags({ tags }: { tags: Tag[] }) {
  return (
    <>
      {tags.map((t) => (
        <span key={t} className={`num rounded border px-1 text-[10px] ${TAG[t].cls}`}>
          {TAG[t].label}
        </span>
      ))}
    </>
  );
}

function TrackButton({ address }: { address: string }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api('/me/tracked', { body: { address, label: short(address) } }),
    onSuccess: () => {
      toast({ title: 'Wallet tracked', body: 'You will see it labelled across Magura', tone: 'lime' });
      qc.invalidateQueries({ queryKey: ['coin-trades'] });
      qc.invalidateQueries({ queryKey: ['coin-holders'] });
    },
  });
  if (!me) return null;
  return (
    <button onClick={() => m.mutate()} disabled={m.isPending} className="text-[11px] text-faint opacity-0 hover:text-lime group-hover:opacity-100 focus:opacity-100">
      Track
    </button>
  );
}

/** Live trades and labelled holders for one coin. */
export function CoinActivity({ chain, address }: { chain: ChainId; address: string }) {
  const [tab, setTab] = useState<'trades' | 'holders'>('trades');
  const [filter, setFilter] = useState<FilterId>('all');
  const [minUsd, setMinUsd] = useState(0);
  const explorer = CHAINS[chain].explorer;

  const trades = useQuery({
    queryKey: ['coin-trades', chain, address, minUsd],
    queryFn: () => api<CoinTrade[]>(`/market/tokens/${chain}/${address}/trades?min=${minUsd}`),
    refetchInterval: 8_000,
    enabled: tab === 'trades',
  });
  const holders = useQuery({
    queryKey: ['coin-holders', chain, address],
    queryFn: () => api<CoinHolder[]>(`/market/tokens/${chain}/${address}/holders`),
    staleTime: 120_000,
    enabled: tab === 'holders',
  });

  const rows = (trades.data ?? []).filter((t) =>
    filter === 'all' ? true : filter === 'magura' ? t.tags.some((x) => x === 'magura' || x === 'you' || x === 'following') : t.tags.includes(filter),
  );

  return (
    <section aria-label="Coin activity" className="panel flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        {(['trades', 'holders'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`h-8 rounded-lg px-3 text-xs font-semibold ${tab === t ? 'bg-line-2 text-text' : 'text-muted hover:text-text'}`}>
            {t === 'trades' ? 'Trades' : 'Holders'}
          </button>
        ))}
        {tab === 'trades' && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={filter === f.id ? 'chip-on h-7 text-[11px]' : 'chip h-7 text-[11px]'}>
                {f.label}
              </button>
            ))}
            <select
              aria-label="Minimum trade size"
              value={minUsd}
              onChange={(e) => setMinUsd(Number(e.target.value))}
              className="num h-7 rounded-lg border border-line-2 bg-raised px-1.5 text-[11px] text-text-2"
            >
              {[0, 50, 250, 1000].map((v) => (
                <option key={v} value={v}>
                  {v ? `≥ $${v}` : 'Any size'}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {tab === 'trades' && (
        <div className="scroll-thin max-h-[380px] overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="label text-left">
                <th className="py-2 pl-4 font-medium">Side</th>
                <th className="px-2 text-right font-medium">Amount</th>
                <th className="px-2 text-right font-medium">MC</th>
                <th className="px-2 font-medium">Trader</th>
                <th className="pr-4 text-right font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.txHash + t.wallet} className="group h-8 border-t border-[#151820]">
                  <td className={`num pl-4 text-[11px] font-semibold ${t.side === 'buy' ? 'text-lime' : 'text-down-2'}`}>{t.side.toUpperCase()}</td>
                  <td className="num px-2 text-right">{t.usd != null ? fmtUsd(t.usd, { compact: t.usd >= 10_000 }) : '—'}</td>
                  <td className="num px-2 text-right text-text-2">{fmtUsd(t.mcUsd)}</td>
                  <td className="px-2">
                    <span className="flex items-center gap-1.5">
                      <a href={`${explorer}/account/${t.wallet}`} target="_blank" rel="noreferrer" className={t.name ? 'text-text-2 hover:text-text' : 'num text-muted hover:text-text'}>
                        {t.name ?? short(t.wallet)}
                      </a>
                      <Tags tags={t.tags} />
                      {!t.tags.includes('tracked') && !t.tags.includes('you') && <TrackButton address={t.wallet} />}
                    </span>
                  </td>
                  <td className="num pr-4 text-right text-faint">{fmtAge(t.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {trades.isLoading && <p className="p-4 text-sm text-muted">Loading trades…</p>}
          {!trades.isLoading && rows.length === 0 && (
            <Empty icon={Icon.trend} title={filter === 'all' ? 'No trades yet' : 'Nobody from this group has traded it yet'}>
              {filter === 'tracked' ? 'Track wallets from any trade row to see them here.' : undefined}
            </Empty>
          )}
        </div>
      )}

      {tab === 'holders' && (
        <div className="scroll-thin max-h-[380px] overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="label text-left">
                <th className="py-2 pl-4 font-medium">#</th>
                <th className="px-2 font-medium">Holder</th>
                <th className="pr-4 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {(holders.data ?? []).map((h, i) => (
                <tr key={h.address} className="group h-8 border-t border-[#151820]">
                  <td className="num pl-4 text-faint">{i + 1}</td>
                  <td className="px-2">
                    <span className="flex items-center gap-1.5">
                      <a href={`${explorer}/account/${h.address}`} target="_blank" rel="noreferrer" className={h.name ? 'text-text-2 hover:text-text' : 'num text-muted hover:text-text'}>
                        {h.name ?? short(h.address)}
                      </a>
                      <Tags tags={h.tags} />
                      {!h.tags.includes('pool') && !h.tags.includes('tracked') && !h.tags.includes('you') && <TrackButton address={h.address} />}
                    </span>
                  </td>
                  <td className="pr-4 text-right">
                    <span className="flex items-center justify-end gap-2">
                      <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-line-2 sm:block">
                        <span className="block h-full bg-text-2" style={{ width: `${Math.min(100, h.pct)}%` }} />
                      </span>
                      <span className="num w-12">{h.pct.toFixed(2)}%</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {holders.isLoading && <p className="p-4 text-sm text-muted">Loading holders…</p>}
          {!holders.isLoading && !holders.data?.length && <Empty icon={Icon.globe} title="Holder data not available yet">New coins can take a few minutes to be indexed.</Empty>}
        </div>
      )}
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fmtAge, fmtUsd } from '@magura/shared';
import { api } from '@/lib/api';
import { ProSidebar } from '@/components/pro-sidebar';
import { TagPill } from '@/components/wallet-tables';
import { Avatar, Delta, Empty, Icon, Segmented } from '@/components/ui';
import { SmartFlow } from '@/components/smart-flow';
import { TopCallers } from '@/components/top-callers';

interface Row {
  wallet: string;
  pnl: number;
  buys: number;
  sells: number;
  winRate: number | null;
  volume: number;
  coins: number;
  handle?: string | null;
  smart?: boolean;
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const sol = (v: number, sign = false) => `${sign && v > 0 ? '+' : ''}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)} SOL`;

export default function SmartPage() {
  const [tab, setTab] = useState<'rank' | 'flow' | 'radar' | 'callers'>('rank');
  return (
    <div className="flex w-full items-start">
      <ProSidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Smart money</h1>
          <Segmented
            label="View"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'rank', label: 'Rank' },
              { value: 'flow', label: 'Smart flow' },
              { value: 'radar', label: 'Radar' },
              { value: 'callers', label: 'Top callers' },
            ]}
          />
          <span className="text-xs text-muted">From every pump.fun trade, live</span>
        </div>
        {tab === 'rank' && <Rank />}
        {tab === 'flow' && <SmartFlow />}
        {tab === 'radar' && <Radar />}
        {tab === 'callers' && <TopCallers />}
      </div>
    </div>
  );
}

function Rank() {
  const [window, setWindow] = useState<'1d' | '7d' | '30d'>('1d');
  const [sort, setSort] = useState<'pnl' | 'winrate' | 'volume'>('pnl');
  const q = useQuery({ queryKey: ['smart-rank', window, sort], queryFn: () => api<Row[]>(`/market/smart/rank?window=${window}&sort=${sort}`), refetchInterval: 60_000 });
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <Segmented label="Window" value={window} onChange={setWindow} options={(['1d', '7d', '30d'] as const).map((v) => ({ value: v, label: v.toUpperCase() }))} />
        <Segmented
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'pnl', label: 'PnL' },
            { value: 'winrate', label: 'Win rate' },
            { value: 'volume', label: 'Volume' },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12px]">
          <thead>
            <tr className="label border-b border-line text-left">
              <th className="py-2.5 pl-3 font-medium">#</th>
              <th className="font-medium">Wallet</th>
              <th className="px-2 text-right font-medium">Realized PnL</th>
              <th className="px-2 text-right font-medium">Win rate</th>
              <th className="px-2 text-right font-medium">Buys / sells</th>
              <th className="px-2 text-right font-medium">Volume</th>
              <th className="pr-3 text-right font-medium">Coins</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((r, i) => (
              <tr key={r.wallet} className="border-b border-[#151820] hover:bg-hover">
                <td className="num py-2 pl-3 text-muted">{i + 1}</td>
                <td>
                  <Link href={`/w/solana/${r.wallet}`} className="flex items-center gap-2">
                    <Avatar name={r.handle ?? r.wallet} size={24} shape="circle" />
                    <span className="num font-semibold">{r.handle ? `@${r.handle}` : short(r.wallet)}</span>
                    {r.smart && <TagPill tag="smart" />}
                  </Link>
                </td>
                <td className={`num px-2 text-right font-semibold ${r.pnl >= 0 ? 'text-lime' : 'text-down-2'}`}>{sol(r.pnl, true)}</td>
                <td className="num px-2 text-right">{r.winRate != null ? `${r.winRate}%` : '—'}</td>
                <td className="num px-2 text-right">
                  <span className="text-lime">{r.buys}</span>/<span className="text-down-2">{r.sells}</span>
                </td>
                <td className="num px-2 text-right text-text-2">{sol(r.volume)}</td>
                <td className="num pr-3 text-right text-text-2">{r.coins}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.isLoading && <p className="p-6 text-sm text-muted">Loading wallets…</p>}
        {q.data?.length === 0 && <Empty icon={Icon.trend} title="Ranking is warming up">Wallets appear as they close trades. Check back in a few minutes.</Empty>}
      </div>
    </section>
  );
}

function Radar() {
  const [input, setInput] = useState('');
  const [coins, setCoins] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ['radar', coins.join(',')],
    queryFn: () => api<{ missing: string[]; wallets: { wallet: string; spent: number; received: number; holdingIn: number; earliestMs: number; smart: boolean }[] }>(`/market/smart/radar?chain=solana&coins=${coins.join(',')}`),
    enabled: coins.length >= 2,
  });
  return (
    <section className="panel flex flex-col gap-3 p-3">
      <p className="text-[13px] text-muted">Paste 2–6 coin addresses. Radar finds the wallets that traded every one of them — often the same insiders or a smart trader worth following.</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setCoins(input.split(/[\s,]+/).filter((x) => x.length > 30).slice(0, 6));
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Mint addresses, separated by spaces or commas" className="input num h-10 flex-1 text-[12px]" />
        <button className="btn-lime h-10 px-4 text-sm">Scan</button>
      </form>
      {q.data?.missing.length ? <p className="text-[12px] text-amber">No ledger yet for: {q.data.missing.map(short).join(', ')} — Radar works on coins launched in the last day.</p> : null}
      {q.data?.wallets.map((w) => (
        <Link key={w.wallet} href={`/w/solana/${w.wallet}`} className="flex items-center gap-3 rounded-xl border border-line-2 bg-raised px-3 py-2 hover:bg-hover">
          <span className="num font-semibold">{short(w.wallet)}</span>
          {w.smart && <TagPill tag="smart" />}
          <span className="num ml-auto text-[11px] text-muted">spent {w.spent.toFixed(2)} · got {w.received.toFixed(2)} SOL</span>
          <span className="num text-[11px] text-text-2">holds {w.holdingIn}/{coins.length}</span>
        </Link>
      ))}
      {q.data && !q.data.missing.length && q.data.wallets.length === 0 && <p className="text-[13px] text-muted">No wallet traded all of these.</p>}
    </section>
  );
}

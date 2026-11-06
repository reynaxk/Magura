'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WalletCopyPanel } from '@/components/wallet-copy';
import { useQuery } from '@tanstack/react-query';
import { fmtUsd } from '@magura/shared';
import { api } from '@/lib/api';
import type { LeaderRow } from '@/components/terminal';
import { Avatar, Delta, Empty, Segmented, Icon } from '@/components/ui';

export default function CopyPage() {
  return (
    <Suspense>
      <CopyInner />
    </Suspense>
  );
}

function CopyInner() {
  const params = useSearchParams();
  const walletParam = params.get('wallet') ?? '';
  const [mode, setMode] = useState<'traders' | 'wallets'>(walletParam ? 'wallets' : 'traders');
  const [days, setDays] = useState<'7' | '30' | '90' | '3650'>('30');
  const [q, setQ] = useState('');
  const lb = useQuery({ queryKey: ['leaderboard', days], queryFn: () => api<LeaderRow[]>(`/copy/leaderboard?days=${days}`) });
  const rows = (lb.data ?? []).filter((r) => r.handle.includes(q.toLowerCase()));
  const podium = rows.slice(0, 3);

  const tabs = (
    <Segmented
      label="Copy"
      value={mode}
      onChange={setMode}
      options={[
        { value: 'traders', label: 'Magura traders' },
        { value: 'wallets', label: 'Any wallet' },
      ]}
    />
  );
  if (mode === 'wallets')
    return (
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-4">
          <h1 className="text-[26px] font-semibold tracking-tight md:text-[34px]">Copy any wallet.</h1>
          <div className="ml-auto">{tabs}</div>
        </div>
        <WalletCopyPanel initialWallet={walletParam} />
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 p-4 md:p-6">
      <div>{tabs}</div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight md:text-[34px]">Copy the best. Automatically.</h1>
          <p className="text-sm text-muted">Pick a trader, set your limits, and every spot buy and sell mirrors into your wallet.</p>
        </div>
        <div className="ml-auto">
          <Segmented
            label="Period"
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7D' },
              { value: '30', label: '30D' },
              { value: '90', label: '90D' },
              { value: '3650', label: 'All' },
            ]}
          />
        </div>
      </div>

      {podium.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
          {podium.map((t, i) => (
            <Link key={t.handle} href={`/u/${t.handle}`} className={`panel flex flex-col gap-4 p-5 hover:bg-hover ${i === 0 ? 'border-lime-line' : ''}`}>
              <div className="flex items-center gap-3">
                <Avatar name={t.handle} src={t.avatarUrl} size={52} />
                <div className="flex flex-col">
                  <span className="text-[17px] font-semibold">{t.handle}</span>
                  <span className="text-xs text-muted">{t.copiers} copiers · {t.trades} trades</span>
                </div>
                <span className={`num ml-auto text-[22px] font-semibold ${i === 0 ? 'text-lime' : 'text-muted'}`}>#{i + 1}</span>
              </div>
              <div className="num grid grid-cols-3 gap-2">
                <Stat k="ROI" v={<Delta value={t.roiPct} />} />
                <Stat k="Win rate" v={t.winRatePct != null ? `${t.winRatePct.toFixed(0)}%` : '—'} />
                <Stat k="PnL" v={fmtUsd(t.pnlUsd)} />
              </div>
              <span className="btn-lime h-11">View & copy</span>
            </Link>
          ))}
        </div>
      )}

      <section aria-label="Leaderboard" className="panel px-5 pb-3 pt-2">
        <div className="flex flex-wrap items-center gap-3 py-3">
          <h2 className="text-[17px] font-semibold">Leaderboard</h2>
          <label className="ml-auto flex h-9 items-center rounded-xl border border-line-2 bg-raised px-3">
            <span className="sr-only">Search traders</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search traders" className="w-44 bg-transparent text-[13px] outline-none placeholder:text-faint" />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="label border-b border-line text-left">
                <th className="py-2.5 font-medium">#</th>
                <th className="font-medium">Trader</th>
                <th className="font-medium">ROI</th>
                <th className="font-medium">PnL</th>
                <th className="font-medium">Win rate</th>
                <th className="font-medium">Trades</th>
                <th className="font-medium">Copiers</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.handle} className="border-b border-[#151820]">
                  <td className="num py-3 text-muted">{r.rank}</td>
                  <td>
                    <Link href={`/u/${r.handle}`} className="flex items-center gap-2.5 font-semibold">
                      <Avatar name={r.handle} src={r.avatarUrl} size={34} />
                      {r.handle}
                    </Link>
                  </td>
                  <td>
                    <Delta value={r.roiPct} />
                  </td>
                  <td className="num">{fmtUsd(r.pnlUsd)}</td>
                  <td className="num">{r.winRatePct != null ? `${r.winRatePct.toFixed(0)}%` : '—'}</td>
                  <td className="num">{r.trades}</td>
                  <td className="num">{r.copiers}</td>
                  <td className="text-right">
                    <Link href={`/u/${r.handle}#copy`} className="btn-lime h-8 text-xs">
                      Copy
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!lb.isLoading && rows.length === 0 && <Empty icon={Icon.trend} title="No ranked traders yet">Traders appear here once they have closed spot trades in this period and allow copying.</Empty>}
        </div>
      </section>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-sans text-[11px] text-muted">{k}</span>
      <span className="num text-base">{v}</span>
    </div>
  );
}

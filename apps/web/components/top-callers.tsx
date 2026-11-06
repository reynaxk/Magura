'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Avatar, Empty, Icon, Segmented } from './ui';

interface Caller {
  handle: string;
  avatarUrl: string | null;
  calls: number;
  avgPct: number | null;
  hitRatePct: number | null;
  hit2xPct: number | null;
  best: { symbol: string; pct: number } | null;
}

const x = (pct: number | null) => (pct == null ? '—' : `${(1 + pct / 100).toFixed(2)}x`);

/** Who calls winners: average multiple since the call, hit rate, 2x rate, best call. */
export function TopCallers() {
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const q = useQuery({ queryKey: ['top-callers', days], queryFn: () => api<Caller[]>(`/callers/top?days=${days}`), refetchInterval: 60_000 });
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Segmented
          label="Window"
          value={days}
          onChange={setDays}
          options={[
            { value: '1', label: '24H' },
            { value: '7', label: '7D' },
            { value: '30', label: '30D' },
          ]}
        />
        <span className="text-xs text-muted">Calls posted in public groups, scored from the price at the call</span>
      </div>
      {q.data?.map((c, i) => (
        <Link key={c.handle} href={`/u/${c.handle}`} className="flex items-center gap-3 border-b border-[#151820] px-3 py-2.5 hover:bg-hover">
          <span className="num w-6 text-center text-[12px] text-muted">{i + 1}</span>
          <Avatar name={c.handle} src={c.avatarUrl} size={32} shape="circle" />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-[13px] font-semibold">@{c.handle}</span>
            <span className="num text-[11px] text-muted">{c.calls} calls</span>
          </span>
          <span className="num flex w-20 flex-col items-end leading-tight">
            <span className={`text-[13px] font-semibold ${(c.avgPct ?? 0) >= 0 ? 'text-lime' : 'text-down-2'}`}>{x(c.avgPct)}</span>
            <span className="text-[10px] text-faint">avg</span>
          </span>
          <span className="num flex w-16 flex-col items-end leading-tight">
            <span className="text-[13px]">{c.hit2xPct != null ? `${Math.round(c.hit2xPct)}%` : '—'}</span>
            <span className="text-[10px] text-faint">hit 2x</span>
          </span>
          <span className="num hidden w-28 flex-col items-end leading-tight sm:flex">
            <span className="text-[12px] text-lime">{c.best ? `${c.best.symbol} ${x(c.best.pct)}` : '—'}</span>
            <span className="text-[10px] text-faint">best call</span>
          </span>
        </Link>
      ))}
      {q.data?.length === 0 && <Empty icon={Icon.trend} title="No scored calls yet">Post calls in a group — they're scored from the price at the moment you call.</Empty>}
    </section>
  );
}

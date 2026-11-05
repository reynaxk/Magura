'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usdText, type RecapData } from '@/lib/pnl-card';
import { useSession } from '@/lib/session';
import { toast } from './toaster';

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** "Your November recap" — this month and last month, shareable. */
export function RecapCard() {
  const { me } = useSession();
  const now = new Date();
  const months = [ym(now), ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))];
  const [month, setMonth] = useState(months[0]);
  const q = useQuery({ queryKey: ['recap', me?.handle, month], queryFn: () => api<RecapData>(`/cards/recap/${me!.handle}/${month}`), enabled: !!me });
  if (!me) return null;
  const d = q.data;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const page = `${origin}/s/recap/${me.handle}/${month}`;
  const img = `/card/recap/${me.handle}/${month}`;
  const text = d ? `My ${d.label} on Magura: ${(d.realizedUsd >= 0 ? '+' : '') + usdText(d.realizedUsd)} realized over ${d.trades} trades. Join with my link for 10% off fees:` : '';
  return (
    <section className="panel flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[17px] font-semibold">Your {d?.label.split(' ')[0] ?? 'month'} recap</h2>
        <span className="ml-auto flex gap-0.5 rounded-lg border border-line-2 p-0.5 text-[11px]">
          {months.map((m, i) => (
            <button key={m} onClick={() => setMonth(m)} className={`rounded-md px-2 py-0.5 ${m === month ? 'bg-line-2 text-text' : 'text-muted'}`}>
              {i === 0 ? 'This month' : 'Last month'}
            </button>
          ))}
        </span>
      </div>
      {d && d.trades > 0 ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt={`Your ${d.label} recap`} className="aspect-[1200/630] w-full rounded-xl border border-line bg-raised" />
          <div className="grid grid-cols-3 gap-2">
            <a href={img} download={`magura-${month}.png`} className="btn-ghost h-10 text-xs">
              Download
            </a>
            <button className="btn-ghost h-10 text-xs" onClick={() => navigator.clipboard.writeText(`${text} ${page}`).then(() => toast({ title: 'Copied', body: 'Paste it anywhere', tone: 'lime' }))}>
              Copy link
            </button>
            <a href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(page)}`} target="_blank" rel="noreferrer" className="btn-lime h-10 text-xs">
              Post on X
            </a>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">{q.isLoading ? 'Loading…' : 'No trades this month yet. Your recap builds as you trade.'}</p>
      )}
    </section>
  );
}

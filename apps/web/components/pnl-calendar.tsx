'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fmtUsd } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from './toaster';

interface CalendarData {
  days: Record<string, number>;
  totalUsd: number;
  greenDays: number;
  redDays: number;
  currentStreak: number;
  bestStreak: number;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Month grid of daily realized PnL with streaks — shareable as an image. */
export function PnlCalendar() {
  const { me } = useSession();
  const [cursor, setCursor] = useState(() => new Date());
  const month = monthKey(cursor);
  const q = useQuery({ queryKey: ['pnl-calendar', me?.handle, month], queryFn: () => api<CalendarData>(`/cards/calendar/${me!.handle}/${month}`), enabled: !!me });
  if (!me) return null;
  const y = cursor.getUTCFullYear();
  const m = cursor.getUTCMonth();
  const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const d = q.data;
  const max = Math.max(1, ...Object.values(d?.days ?? {}).map(Math.abs));
  const today = new Date().toISOString().slice(0, 10);
  const shift = (n: number) => setCursor(new Date(Date.UTC(y, m + n, 1)));
  const isCurrent = monthKey(new Date()) === month;
  const img = `/card/calendar/${me.handle}/${month}`;
  const share = async () => {
    const url = `${window.location.origin}${img}`;
    const text = `My ${new Date(Date.UTC(y, m, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })} on Magura: ${d && d.totalUsd >= 0 ? '+' : ''}${fmtUsd(d?.totalUsd ?? 0)} · ${d?.currentStreak ?? 0} day streak 🔥`;
    if (navigator.share) await navigator.share({ text, url }).catch(() => undefined);
    else {
      await navigator.clipboard?.writeText(`${text}\n${url}`);
      toast({ title: 'Copied', body: 'Paste it anywhere', tone: 'lime' });
    }
  };

  return (
    <section aria-label="PnL calendar" className="panel flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-[17px] font-semibold">PnL calendar</h2>
        <span className="ml-auto flex items-center gap-1">
          <button aria-label="Previous month" onClick={() => shift(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-text-2 hover:text-text">
            ‹
          </button>
          <span className="num w-[92px] text-center text-[13px] text-text-2">{new Date(Date.UTC(y, m, 1)).toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>
          <button aria-label="Next month" disabled={isCurrent} onClick={() => shift(1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-text-2 hover:text-text disabled:opacity-30">
            ›
          </button>
        </span>
      </div>
      <div className="num grid grid-cols-4 gap-2">
        {[
          ['Month', d ? `${d.totalUsd >= 0 ? '+' : ''}${fmtUsd(d.totalUsd)}` : '—', d && d.totalUsd < 0 ? 'text-down-2' : 'text-lime'],
          ['Green days', d ? `${d.greenDays}/${d.greenDays + d.redDays}` : '—', 'text-text'],
          ['Streak', d ? `${d.currentStreak} 🔥` : '—', 'text-text'],
          ['Best', d ? String(d.bestStreak) : '—', 'text-text'],
        ].map(([k, v, c]) => (
          <div key={k} className="flex flex-col gap-0.5 rounded-xl bg-raised p-2.5">
            <span className="text-[10.5px] text-muted">{k}</span>
            <span className={`text-[14px] font-semibold ${c}`}>{v}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
          <span key={i} className="text-center text-[10px] font-semibold text-faint">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={i} />;
          const key = `${month}-${String(day).padStart(2, '0')}`;
          const v = d?.days[key];
          const a = v != null ? 0.16 + 0.6 * (Math.abs(v) / max) : 0;
          return (
            <div
              key={i}
              title={v != null ? `${key}: ${v >= 0 ? '+' : ''}${fmtUsd(v)}` : key}
              className={`flex aspect-square min-w-0 flex-col justify-between rounded-lg border p-1 ${key === today ? 'border-lime-line' : 'border-line'}`}
              style={{ background: v == null ? '#0F1116' : v >= 0 ? `rgba(47,227,154,${a})` : `rgba(255,107,107,${a})` }}
            >
              <span className="num text-[9.5px] text-muted">{day}</span>
              {v != null && <span className="num truncate text-[9.5px] font-semibold text-text">{fmtUsd(v, { compact: true })}</span>}
            </div>
          );
        })}
      </div>
      <button onClick={share} disabled={!d} className="btn-ghost h-10 text-sm">
        Share calendar
      </button>
    </section>
  );
}

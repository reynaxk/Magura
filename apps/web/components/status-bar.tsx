'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLiveStatus } from '@/lib/socket';
import { Dock } from './dock';

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : `$${v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2)}`;

/** Live connection dot + label, used in the header. */
export function LivePill() {
  const { state, age } = useLiveStatus();
  const tone = state === 'live' ? 'bg-lime' : state === 'stale' ? 'bg-amber' : 'bg-down';
  const label = state === 'live' ? 'Live' : state === 'stale' ? `Stale · ${age}s` : 'Offline';
  return (
    <span
      title={state === 'live' ? 'Real-time data is flowing' : state === 'stale' ? 'No updates for a while — data may be behind' : 'Disconnected — reconnecting'}
      className="num hidden items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-1 text-[11px] text-muted lg:flex"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone} ${state === 'live' ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  );
}

/** Thin desktop bar: connection, majors, copy trades running, shortcuts hint. */
export function StatusBar() {
  const path = usePathname();
  const { me } = useSession();
  const { state } = useLiveStatus();
  const ticker = useQuery({
    queryKey: ['ticker'],
    queryFn: () => api<Record<string, number | null>>('/market/ticker'),
    refetchInterval: 30_000,
  });
  const subs = useQuery({
    queryKey: ['copy-subs'],
    queryFn: () => api<{ status: string }[]>('/copy/subscriptions'),
    enabled: !!me,
    refetchInterval: 60_000,
  });
  if (path?.startsWith('/onboarding')) return null;
  const running = subs.data?.filter((s) => s.status === 'active').length ?? 0;
  const dot = state === 'live' ? 'bg-lime' : state === 'stale' ? 'bg-amber' : 'bg-down';
  return (
    <footer className="num fixed inset-x-0 bottom-0 z-30 hidden h-[30px] items-center gap-5 border-t border-line bg-bar px-6 text-[11px] text-faint md:flex">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {state === 'offline' ? 'Reconnecting' : 'Connected'}
      </span>
      <Dock />
      {(['SOL', 'ETH', 'BNB', 'BTC'] as const).map((k) => (
        <span key={k}>
          {k} <span className="text-text-2">{fmt(ticker.data?.[k])}</span>
        </span>
      ))}
      {me && (
        <span className="ml-auto">
          {running} copy trade{running === 1 ? '' : 's'} running
        </span>
      )}
      <span className={me ? '' : 'ml-auto'}>
        Press <kbd className="rounded border border-line-3 px-1 text-text-2">?</kbd> for shortcuts
      </span>
    </footer>
  );
}

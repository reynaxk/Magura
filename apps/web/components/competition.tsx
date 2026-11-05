'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fmtUsd } from '@magura/shared';
import { api } from '@/lib/api';
import { Avatar, Delta, Segmented } from './ui';

interface GroupRank {
  slug: string;
  name: string;
  iconUrl: string | null;
  color: string;
  members: number;
  active: number;
  realizedUsd: number;
  roiPct: number | null;
}
interface Champion {
  slug: string;
  name: string;
  roiPct: number;
  discountPct: number;
}

/** Last week's winning group — its members pay less this week. */
export function useChampion() {
  return useQuery({ queryKey: ['comp-groups', 'current'], queryFn: () => api<{ champion: Champion | null }>(`/competitions/groups?week=current`), staleTime: 300_000, select: (d) => d.champion });
}

export function ChampionBadge({ slug }: { slug: string }) {
  const c = useChampion();
  if (c.data?.slug !== slug) return null;
  return (
    <span title={`Group of last week · members pay ${c.data.discountPct}% less this week`} className="rounded-md border border-lime-line bg-lime-dim px-1.5 py-0.5 text-[10px] font-semibold text-lime">
      Champion
    </span>
  );
}

interface MemberRank {
  handle: string;
  avatarUrl: string | null;
  realizedUsd: number;
  roiPct: number | null;
  trades: number;
}
interface CallerRank {
  handle: string;
  avatarUrl: string | null;
  calls: number;
  avgPct: number | null;
  hitRatePct: number | null;
  best: { symbol: string; pct: number } | null;
}

/** "Ends in 3d 4h" for the weekly window. */
function useCountdown(to: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!to) return '';
  const ms = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function GroupIcon({ g, size = 36 }: { g: Pick<GroupRank, 'name' | 'iconUrl' | 'color'>; size?: number }) {
  return g.iconUrl ? (
    <Avatar name={g.name} src={g.iconUrl} size={size} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-[10px] text-xs font-semibold text-bar" style={{ width: size, height: size, background: g.color }}>
      {g.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Weekly group-vs-group leaderboard (Groups page). */
export function GroupCompetition() {
  const [week, setWeek] = useState<'current' | 'last'>('current');
  const q = useQuery({
    queryKey: ['comp-groups', week],
    queryFn: () => api<{ from: string; to: string; groups: GroupRank[]; champion: Champion | null }>(`/competitions/groups?week=${week}`),
    refetchInterval: 120_000,
  });
  const champ = q.data?.champion;
  const ends = useCountdown(q.data?.to);
  const rows = q.data?.groups ?? [];
  return (
    <section aria-label="Group competition" className="panel flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[17px] font-semibold">Group of the week</h2>
          <span className="text-xs text-muted">
            Groups ranked by members&apos; realized return this week{week === 'current' && ends ? ` · ends in ${ends}` : ''}
          </span>
        </div>
        <span className="ml-auto">
          <Segmented
            label="Week"
            value={week}
            onChange={setWeek}
            options={[
              { value: 'current', label: 'This week' },
              { value: 'last', label: 'Last week' },
            ]}
          />
        </span>
      </div>
      {champ && (
        <Link href={`/groups/${champ.slug}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-lime-dim px-5 py-3 text-[13px] hover:brightness-110">
          <span className="font-semibold text-lime">Last week&apos;s champion: {champ.name}</span>
          <span className="text-text-2">
            <Delta value={champ.roiPct} /> · members pay {champ.discountPct}% less on fees all this week
          </span>
        </Link>
      )}
      {rows.length ? (
        <ol className="flex flex-col">
          {rows.slice(0, 10).map((g, i) => (
            <li key={g.slug}>
              <Link href={`/groups/${g.slug}`} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-hover">
                <span className={`num w-6 text-sm ${i === 0 ? 'text-lime' : 'text-muted'}`}>{i + 1}</span>
                <GroupIcon g={g} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{g.name}</span>
                  <span className="text-xs text-muted">
                    {g.active} of {g.members} trading
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="text-sm">{g.roiPct != null ? <Delta value={g.roiPct} /> : <span className="text-xs text-faint">Not ranked</span>}</span>
                  <span className="num text-[11px] text-muted">{fmtUsd(g.realizedUsd)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-6 text-sm text-muted">{q.isLoading ? 'Loading…' : 'No group has traded enough yet. Groups need $50+ traded to rank.'}</p>
      )}
    </section>
  );
}

/** In-group weekly leaderboard + caller scoreboard (group sidebar). */
export function GroupBoards({ slug }: { slug: string }) {
  const [tab, setTab] = useState<'week' | 'callers'>('week');
  const board = useQuery({ queryKey: ['group-board', slug], queryFn: () => api<{ to: string; members: MemberRank[] }>(`/groups/${slug}/leaderboard`), enabled: tab === 'week', refetchInterval: 120_000 });
  const callers = useQuery({ queryKey: ['group-callers', slug], queryFn: () => api<CallerRank[]>(`/groups/${slug}/callers?days=30`), enabled: tab === 'callers' });
  const ends = useCountdown(board.data?.to);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {(
          [
            ['week', 'This week'],
            ['callers', 'Top callers'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`h-7 rounded-lg px-2.5 text-[11px] font-semibold ${tab === id ? 'bg-line-2 text-text' : 'text-muted hover:text-text'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'week' && (
        <>
          {ends && <span className="px-1 text-[11px] text-faint">Ends in {ends}</span>}
          {(board.data?.members ?? []).slice(0, 8).map((m, i) => (
            <Link key={m.handle} href={`/u/${m.handle}`} className="flex items-center gap-2 rounded-[10px] px-1.5 py-1.5 hover:bg-panel">
              <span className={`num w-4 text-[11px] ${i === 0 ? 'text-lime' : 'text-faint'}`}>{i + 1}</span>
              <Avatar name={m.handle} src={m.avatarUrl} size={24} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{m.handle}</span>
              <span className={`num text-[11px] ${m.realizedUsd >= 0 ? 'text-lime' : 'text-down-2'}`}>{fmtUsd(m.realizedUsd)}</span>
            </Link>
          ))}
          {!board.isLoading && !board.data?.members.length && <span className="px-1 text-xs text-muted">No closed trades this week yet.</span>}
        </>
      )}
      {tab === 'callers' && (
        <>
          <span className="px-1 text-[11px] text-faint">Average move since each call · 30 days</span>
          {(callers.data ?? []).slice(0, 8).map((c, i) => (
            <Link key={c.handle} href={`/u/${c.handle}`} className="flex items-center gap-2 rounded-[10px] px-1.5 py-1.5 hover:bg-panel">
              <span className={`num w-4 text-[11px] ${i === 0 ? 'text-lime' : 'text-faint'}`}>{i + 1}</span>
              <Avatar name={c.handle} src={c.avatarUrl} size={24} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12px] font-semibold">{c.handle}</span>
                <span className="num text-[10px] text-faint">
                  {c.calls} call{c.calls === 1 ? '' : 's'}
                  {c.hitRatePct != null ? ` · ${c.hitRatePct.toFixed(0)}% up` : ''}
                </span>
              </span>
              <span className="text-[11px]">{c.avgPct != null ? <Delta value={c.avgPct} /> : <span className="text-faint">—</span>}</span>
            </Link>
          ))}
          {!callers.isLoading && !callers.data?.length && <span className="px-1 text-xs text-muted">No calls in the last 30 days.</span>}
        </>
      )}
    </div>
  );
}

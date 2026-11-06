'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fmtAge, fmtUsd } from '@magura/shared';
import { api } from '@/lib/api';
import { usePref } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import { Avatar } from './ui';

type WinId = 'holdings' | 'feed' | 'alerts' | 'tracked';
const WINDOWS: { id: WinId; label: string }[] = [
  { id: 'holdings', label: 'Holdings' },
  { id: 'feed', label: 'Feed' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'tracked', label: 'Wallet tracker' },
];

/** A small draggable window. Position is remembered per window. */
function Win({ id, title, onClose, index, children }: { id: WinId; title: string; onClose: () => void; index: number; children: React.ReactNode }) {
  const [pos, setPos] = usePref<{ x: number; y: number } | null>(`dock-pos-${id}`, null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const start = pos ?? { x: (typeof window !== 'undefined' ? window.innerWidth : 1400) - 360 - index * 24, y: (typeof window !== 'undefined' ? window.innerHeight : 900) - 470 - index * 24 };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (!ref.current) return;
      ref.current.style.left = `${Math.max(0, e.clientX - drag.x)}px`;
      ref.current.style.top = `${Math.max(0, e.clientY - drag.y)}px`;
    };
    const up = (e: PointerEvent) => {
      setPos({ x: Math.max(0, e.clientX - drag.x), y: Math.max(0, e.clientY - drag.y) });
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => window.removeEventListener('pointermove', move);
  }, [drag, setPos]);
  return (
    <div ref={ref} role="dialog" aria-label={title} className="fixed z-40 flex h-[420px] w-[340px] flex-col overflow-hidden rounded-2xl border border-line-3 bg-panel shadow-[0_20px_60px_rgba(0,0,0,0.55)]" style={{ left: start.x, top: start.y }}>
      <div
        onPointerDown={(e) => {
          const r = ref.current!.getBoundingClientRect();
          setDrag({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
        className="flex h-9 cursor-grab select-none items-center gap-2 border-b border-line bg-bar px-3 active:cursor-grabbing"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-lime" />
        <span className="text-[12px] font-semibold">{title}</span>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={onClose} aria-label={`Close ${title}`} className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text">
          ×
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function LoginFirst() {
  const { login } = useSession();
  return (
    <div className="flex flex-col items-center gap-2 p-6 text-center">
      <span className="text-[13px] text-muted">Log in to see this.</span>
      <button className="btn-lime h-9 text-xs" onClick={login}>
        Log in
      </button>
    </div>
  );
}

function Holdings() {
  const q = useQuery({ queryKey: ['me-portfolio'], queryFn: () => api<{ realizedUsd: number; positions: { chain: string; address: string; symbol: string; costUsd: number }[] }>('/me/portfolio'), refetchInterval: 20_000 });
  return (
    <div className="flex flex-col">
      <div className="num flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-muted">
        Realized <span className={(q.data?.realizedUsd ?? 0) >= 0 ? 'text-lime' : 'text-down-2'}>{fmtUsd(q.data?.realizedUsd ?? 0)}</span>
        <Link href="/portfolio" className="ml-auto text-lime">
          Portfolio
        </Link>
      </div>
      {q.data?.positions.length === 0 && <p className="p-4 text-[12px] text-muted">No open positions.</p>}
      {q.data?.positions.map((p) => (
        <Link key={`${p.chain}:${p.address}`} href={`/t/${p.chain}/${p.address}`} className="flex items-center gap-2 border-b border-line/60 px-3 py-2 hover:bg-hover">
          <Avatar name={p.symbol} size={24} />
          <span className="flex-1 text-[12px] font-semibold">{p.symbol}</span>
          <span className="num text-[11px] text-text-2">cost {fmtUsd(p.costUsd)}</span>
        </Link>
      ))}
    </div>
  );
}

type FeedItem = { kind: 'trade' | 'call'; id: string; at: string; user: { handle: string; avatarUrl: string | null }; side?: 'buy' | 'sell'; amountUsd?: number | null; coin: { chain: string; address: string; symbol: string } };
function Feed() {
  const q = useQuery({ queryKey: ['dock-feed'], queryFn: () => api<{ items: FeedItem[] }>('/feed?only=all'), refetchInterval: 15_000 });
  return (
    <div className="flex flex-col">
      {q.data?.items.length === 0 && <p className="p-4 text-[12px] text-muted">Follow traders to fill your feed.</p>}
      {q.data?.items.map((i) => (
        <Link key={i.id} href={`/t/${i.coin.chain}/${i.coin.address}`} className="flex items-center gap-2 border-b border-line/60 px-3 py-2 hover:bg-hover">
          <Avatar name={i.user.handle} src={i.user.avatarUrl} size={22} shape="circle" />
          <span className="min-w-0 flex-1 truncate text-[12px]">
            <span className="font-semibold">@{i.user.handle}</span>{' '}
            {i.kind === 'call' ? (
              <span className="text-lime">called</span>
            ) : (
              <span className={i.side === 'buy' ? 'text-lime' : 'text-down-2'}>{i.side === 'buy' ? 'bought' : 'sold'}</span>
            )}{' '}
            <span className="font-semibold">{i.coin.symbol}</span>
          </span>
          {i.amountUsd != null && <span className="num text-[11px] text-text-2">{fmtUsd(i.amountUsd)}</span>}
          <span className="num text-[10px] text-faint">{fmtAge(i.at)}</span>
        </Link>
      ))}
    </div>
  );
}

function Alerts() {
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ id: string; title: string; body: string; href: string | null; createdAt: string }[]>('/notifications'), refetchInterval: 30_000 });
  return (
    <div className="flex flex-col">
      {q.data?.length === 0 && <p className="p-4 text-[12px] text-muted">No alerts yet.</p>}
      {q.data?.map((n) => {
        const body = (
          <span className="flex flex-col gap-0.5 border-b border-line/60 px-3 py-2 hover:bg-hover">
            <span className="flex items-center gap-2">
              <span className="text-[12px] font-semibold">{n.title}</span>
              <span className="num ml-auto text-[10px] text-faint">{fmtAge(n.createdAt)}</span>
            </span>
            <span className="text-[11px] text-muted">{n.body}</span>
          </span>
        );
        return n.href ? (
          <Link key={n.id} href={n.href}>
            {body}
          </Link>
        ) : (
          <div key={n.id}>{body}</div>
        );
      })}
    </div>
  );
}

function Tracked() {
  const q = useQuery({ queryKey: ['me-tracked'], queryFn: () => api<{ address: string; label: string | null; chain?: string }[]>('/me/tracked'), refetchInterval: 60_000 });
  return (
    <div className="flex flex-col">
      {q.data?.length === 0 && <p className="p-4 text-[12px] text-muted">Track wallets from any Trades or Holders row on a coin page.</p>}
      {q.data?.map((w) => (
        <div key={w.address} className="flex items-center gap-2 border-b border-line/60 px-3 py-2">
          <Avatar name={w.label ?? w.address} size={22} shape="circle" />
          <span className="flex-1 text-[12px] font-semibold">{w.label ?? `${w.address.slice(0, 4)}…${w.address.slice(-4)}`}</span>
          <span className="num text-[10px] text-faint">{w.address.slice(0, 6)}…</span>
        </div>
      ))}
    </div>
  );
}

/** Bottom-bar buttons that open floating windows (desktop). */
export function Dock() {
  const { me } = useSession();
  const [open, setOpen] = usePref<WinId[]>('dock-open', []);
  const toggle = (id: WinId) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);
  return (
    <>
      <span className="flex items-center gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            onClick={() => toggle(w.id)}
            aria-pressed={open.includes(w.id)}
            className={`h-[22px] rounded-md px-2 text-[11px] font-semibold ${open.includes(w.id) ? 'bg-lime-dim text-lime' : 'text-muted hover:bg-hover hover:text-text'}`}
          >
            {w.label}
          </button>
        ))}
      </span>
      {open.map((id, i) => (
        <Win key={id} id={id} index={i} title={WINDOWS.find((w) => w.id === id)!.label} onClose={() => toggle(id)}>
          {!me ? <LoginFirst /> : id === 'holdings' ? <Holdings /> : id === 'feed' ? <Feed /> : id === 'alerts' ? <Alerts /> : <Tracked />}
        </Win>
      ))}
    </>
  );
}

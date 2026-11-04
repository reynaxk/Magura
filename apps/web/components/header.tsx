'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fmtUsd, type PairSummary } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar, Icon, Svg } from './ui';

const NAV = [
  { href: '/', label: 'Terminal' },
  { href: '/trenches', label: 'Trenches' },
  { href: '/copy', label: 'Copy' },
  { href: '/groups', label: 'Groups' },
  { href: '/messages', label: 'Messages' },
  { href: '/live', label: 'Live' },
  { href: '/portfolio', label: 'Portfolio' },
];

export function Header() {
  const path = usePathname();
  const { me, login, ready, mode } = useSession();
  const [searchOpen, setSearchOpen] = useState(false);
  const notifs = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ id: string; readAt: string | null }[]>('/notifications'),
    enabled: !!me,
    refetchInterval: 60_000,
  });
  const unread = notifs.data?.filter((n) => !n.readAt).length ?? 0;
  if (path?.startsWith('/onboarding')) return null;

  return (
    <header className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center gap-5 border-b border-line bg-bar/95 px-6 py-3 backdrop-blur">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-lime">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#08090C" strokeWidth="2.4" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-30 12 12)" />
          </svg>
        </span>
        <span className="text-[17px] font-semibold tracking-[0.1em]">MAGURA</span>
      </Link>
      <nav aria-label="Sections" className="flex flex-wrap gap-0.5">
        {NAV.map((n) => {
          const active = n.href === '/' ? path === '/' || path?.startsWith('/t/') : path?.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-9 items-center rounded-xl px-3.5 text-[13px] font-semibold ${active ? 'bg-[#1C2029] text-[#F2F4F8]' : 'text-muted hover:text-text'}`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <button aria-label="Search" onClick={() => setSearchOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line-2 bg-raised text-text-2 hover:bg-hover">
          <Svg d={Icon.search} size={16} />
        </button>
        {me && (
          <Link href="/portfolio#activity" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-line-2 bg-raised text-text-2 hover:bg-hover">
            <Svg d={Icon.bell} size={16} />
            {unread > 0 && <span className="absolute right-2.5 top-2 h-[7px] w-[7px] rounded-full bg-[#FF5468]" />}
          </Link>
        )}
        {me ? (
          <Link href="/settings" className="flex h-10 items-center gap-2.5 rounded-xl border border-line-2 bg-raised py-1 pl-1 pr-3 hover:bg-hover">
            <Avatar name={me.handle} src={me.avatarUrl} size={30} />
            <span className="text-[13px] font-semibold">@{me.handle}</span>
          </Link>
        ) : (
          <button className="btn-lime" onClick={login} disabled={!ready}>
            {mode === 'dev' ? 'Dev login' : 'Log in'}
          </button>
        )}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </header>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const res = useQuery({ queryKey: ['search', debounced], queryFn: () => api<PairSummary[]>(`/market/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 2 });
  return (
    <div role="dialog" aria-modal="true" aria-label="Search" className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-24" onClick={onClose}>
      <div className="panel w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-3 border-b border-line px-4">
          <Svg d={Icon.search} size={16} color="#8A93A6" />
          <span className="sr-only">Search tokens</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a token or paste a contract" className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
        </label>
        <ul className="scroll-thin max-h-[420px] overflow-y-auto p-2">
          {res.data?.map((p) => (
            <li key={`${p.chain}:${p.baseToken.address}`}>
              <button
                className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-hover"
                onClick={() => {
                  router.push(`/t/${p.chain}/${p.baseToken.address}`);
                  onClose();
                }}
              >
                <Avatar name={p.baseToken.symbol} src={p.imageUrl} size={32} shape="circle" />
                <span className="flex flex-1 flex-col">
                  <span className="text-sm font-semibold">{p.baseToken.symbol}</span>
                  <span className="text-xs text-muted">{p.baseToken.name}</span>
                </span>
                <span className="num text-xs text-muted">{p.chain}</span>
                <span className="num w-20 text-right text-xs">{fmtUsd(p.marketCap ?? p.fdv)}</span>
              </button>
            </li>
          ))}
          {debounced.length >= 2 && res.data?.length === 0 && <li className="p-6 text-center text-sm text-muted">No tokens found</li>}
        </ul>
      </div>
    </div>
  );
}

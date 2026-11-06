'use client';

import { LivePill } from './status-bar';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fmtUsd, type PairSummary } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Wordmark } from './logo';
import { Avatar, Icon, Svg } from './ui';

const NAV = [
  { href: '/trenches', label: 'Trenches' },
  { href: '/', label: 'Trending' },
  { href: '/smart', label: 'Smart' },
  { href: '/copy', label: 'Copy' },
  { href: '/feed', label: 'Feed' },
  { href: '/groups', label: 'Groups' },
  { href: '/messages', label: 'Messages' },
  { href: '/live', label: 'Live' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/rewards', label: 'Rewards' },
];

export function Header() {
  const path = usePathname();
  const { me, login, ready, mode } = useSession();
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const open = () => setSearchOpen(true);
    window.addEventListener('magura:search', open);
    return () => window.removeEventListener('magura:search', open);
  }, []);
  const notifs = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ id: string; readAt: string | null }[]>('/notifications'),
    enabled: !!me,
    refetchInterval: 60_000,
  });
  const unread = notifs.data?.filter((n) => !n.readAt).length ?? 0;
  if (path?.startsWith('/onboarding')) return null;

  return (
    <>
    <header className="sticky top-0 z-40 flex min-h-14 items-center gap-5 border-b border-line bg-bar/95 px-4 py-2 backdrop-blur md:min-h-16 md:flex-wrap md:px-6 md:py-3">
      <Link href="/" aria-label="Magura home">
        <span className="md:hidden">
          <Wordmark compact />
        </span>
        <span className="hidden md:inline">
          <Wordmark />
        </span>
      </Link>
      <nav aria-label="Sections" className="hidden flex-wrap gap-0.5 md:flex">
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
        <LivePill />
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
          <Link href="/settings" aria-label="Settings" className="flex h-10 items-center gap-2.5 rounded-xl border border-line-2 bg-raised p-1 hover:bg-hover sm:pr-3">
            <Avatar name={me.handle} src={me.avatarUrl} size={30} />
            <span className="hidden text-[13px] font-semibold sm:inline">@{me.handle}</span>
          </Link>
        ) : (
          <button className="btn-lime" onClick={login} disabled={!ready}>
            {mode === 'dev' ? 'Dev login' : 'Log in'}
          </button>
        )}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </header>
    <BottomNav path={path ?? '/'} />
    </>
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

const TABS = [
  { href: '/', label: 'Trending', d: 'M3 17l5-5 4 4 9-9M15 7h6v6', match: (p: string) => p === '/' || p.startsWith('/t/') },
  { href: '/trenches', label: 'Trenches', d: 'M13 2L4 14h7l-1 8 9-12h-7z', match: (p: string) => p.startsWith('/trenches') },
  { href: '/copy', label: 'Copy', d: 'M8 8h11v11H8zM5 16V5h11', match: (p: string) => p.startsWith('/copy') || p.startsWith('/u/') },
  {
    href: '/feed',
    label: 'Social',
    d: 'M4 5h16v11H9l-5 4z',
    match: (p: string) => p.startsWith('/feed') || p.startsWith('/messages') || p.startsWith('/groups') || p.startsWith('/live') || p.startsWith('/call'),
  },
  { href: '/portfolio', label: 'Wallet', d: 'M3 7h18v13H3zM16 13h2M3 7l3-4h12l3 4', match: (p: string) => p.startsWith('/portfolio') || p.startsWith('/settings') || p.startsWith('/rewards') },
];

/** Phone navigation: five tabs pinned to the bottom of the screen. */
function BottomNav({ path }: { path: string }) {
  return (
    <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-bar/95 px-1 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 backdrop-blur md:hidden">
      {TABS.map((t) => {
        const on = t.match(path);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined} className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold ${on ? 'text-lime' : 'text-muted'}`}>
            <span className={`flex h-7 w-11 items-center justify-center rounded-[10px] ${on ? 'bg-lime-dim' : ''}`}>
              <Svg d={t.d} size={20} />
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Social sub-navigation for phones (Messages · Groups · Live share one tab). */
export function SocialTabs() {
  const path = usePathname() ?? '';
  const items = [
    ['/feed', 'Feed'],
    ['/messages', 'Messages'],
    ['/groups', 'Groups'],
    ['/live', 'Live'],
  ] as const;
  return (
    <div role="tablist" aria-label="Social" className="flex gap-1.5 border-b border-line px-4 py-2.5 md:hidden">
      {items.map(([href, label]) => (
        <Link key={href} href={href} role="tab" aria-selected={path.startsWith(href)} className={path.startsWith(href) ? 'chip-on' : 'chip'}>
          {label}
        </Link>
      ))}
    </div>
  );
}

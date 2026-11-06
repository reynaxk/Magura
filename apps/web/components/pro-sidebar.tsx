'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fmtAge, fmtUsd, type ChatMessageDTO, type HuntToken } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar, Delta } from './ui';

type FriendBuy = { chain: string; address: string; symbol: string; buyers: { handle: string; avatarUrl: string | null }[]; totalUsd: number };

/** Pro layout left rail: what's moving + what people are calling. Always open. */
export function ProSidebar() {
  const { me } = useSession();
  const [tab, setTab] = useState<'hot' | 'new' | 'friends'>('hot');
  const filter = JSON.stringify({ chains: ['solana', 'base', 'bsc', 'ethereum'], sources: [], ranges: {} });
  const list = useQuery({
    queryKey: ['pro-rail', tab],
    queryFn: () => api<HuntToken[]>(`/market/hunt?sort=${tab === 'new' ? 'new' : 'hot'}&limit=25&f=${encodeURIComponent(filter)}`),
    refetchInterval: 15_000,
    enabled: tab !== 'friends',
  });
  const friends = useQuery({ queryKey: ['hunt-friends'], queryFn: () => api<FriendBuy[]>('/market/hunt/friends'), enabled: !!me && tab === 'friends', refetchInterval: 30_000 });
  const calls = useQuery({ queryKey: ['hunt-calls'], queryFn: () => api<(ChatMessageDTO & { group: { slug: string; name: string } })[]>('/market/hunt/calls'), refetchInterval: 30_000 });

  return (
    <aside aria-label="Market rail" className="hidden w-[256px] shrink-0 flex-col border-r border-line bg-bar xl:flex">
      <div role="tablist" className="flex gap-0.5 border-b border-line p-1.5">
        {(
          [
            ['hot', 'Trending'],
            ['new', 'Newest'],
            ['friends', 'Friends'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-7 flex-1 rounded-md text-[11px] font-semibold ${tab === id ? 'bg-raised text-text' : 'text-muted hover:text-text'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="scroll-thin max-h-[52vh] overflow-y-auto">
        {tab !== 'friends' &&
          list.data?.map((t) => (
            <Link key={`${t.chain}:${t.address}`} href={`/t/${t.chain}/${t.address}`} className="flex items-center gap-2 border-b border-line/60 px-2.5 py-1.5 hover:bg-hover">
              <Avatar name={t.symbol} src={t.imageUrl} size={26} />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[12px] font-semibold">{t.symbol}</span>
                <span className="num text-[10px] text-faint">
                  {fmtAge(t.createdAt)} · V {fmtUsd(t.volumeUsd)}
                </span>
              </span>
              <span className="num flex flex-col items-end leading-tight">
                <span className="text-[11px]">{fmtUsd(t.marketCapUsd)}</span>
                <span className="text-[10px]">
                  <Delta value={t.change1h} />
                </span>
              </span>
            </Link>
          ))}
        {tab === 'friends' && !me && <p className="p-4 text-[12px] text-muted">Log in and follow traders to see what they buy.</p>}
        {tab === 'friends' &&
          friends.data?.map((f) => (
            <Link key={`${f.chain}:${f.address}`} href={`/t/${f.chain}/${f.address}`} className="flex items-center gap-2 border-b border-line/60 px-2.5 py-1.5 hover:bg-hover">
              <Avatar name={f.symbol} size={26} />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-[12px] font-semibold">{f.symbol}</span>
                <span className="truncate text-[10px] text-muted">
                  {f.buyers[0]?.handle}
                  {f.buyers.length > 1 ? ` +${f.buyers.length - 1}` : ''}
                </span>
              </span>
              <span className="num text-[11px] text-lime">{fmtUsd(f.totalUsd)}</span>
            </Link>
          ))}
        {tab === 'friends' && me && friends.data?.length === 0 && <p className="p-4 text-[12px] text-muted">Nobody you follow bought in the last 24h.</p>}
      </div>
      <div className="flex items-center border-y border-line px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Calls</span>
        <Link href="/groups" className="ml-auto text-[11px] text-lime">
          Groups
        </Link>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {calls.data?.length === 0 && <p className="p-4 text-[12px] text-muted">No calls yet.</p>}
        {calls.data?.map((c) =>
          c.attachment?.kind === 'call' ? (
            <Link key={c.id} href={`/t/${c.attachment.chain}/${c.attachment.token.address}`} className="flex flex-col gap-1 border-b border-line/60 px-3 py-2 hover:bg-hover">
              <span className="flex items-center gap-1.5">
                <Avatar name={c.author.handle} src={c.author.avatarUrl} size={18} shape="circle" />
                <span className="truncate text-[11px] font-semibold">@{c.author.handle}</span>
                <span className="num ml-auto text-[10px] text-faint">{fmtAge(c.createdAt)}</span>
              </span>
              <span className="num text-[11px]">
                <span className="rounded bg-lime px-1 text-[9px] font-bold text-bg">CALL</span> <span className="font-semibold">{c.attachment.token.symbol}</span>{' '}
                <span className="text-muted">
                  TP {c.attachment.target} · in {c.group.name}
                </span>
              </span>
            </Link>
          ) : null,
        )}
      </div>
    </aside>
  );
}

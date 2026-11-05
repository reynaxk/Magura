'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fmtAge, fmtPrice, fmtUsd, type ChainId, type ChatMessageDTO, type HuntToken, type PairSummary } from '@magura/shared';
import { api } from '@/lib/api';
import { FilterButton, FilterPanel, useStoredFilter } from '@/components/filter-panel';
import { useSession } from '@/lib/session';
import type { LeaderRow } from '@/components/terminal';
import { Avatar, Delta, Empty, Icon, RiskTags, Segmented, Svg } from '@/components/ui';

type Sort = 'hot' | 'gainers' | 'losers' | 'volume' | 'new';

const CHAIN_SHORT: Record<ChainId, string> = { solana: 'SOL', base: 'BASE', bsc: 'BNB', ethereum: 'ETH' };

export default function HuntPage() {
  const { me } = useSession();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('hot');
  const [filter, setFilter] = useStoredFilter('hunt');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ sort, limit: '60', f: JSON.stringify(filter) });

  const list = useQuery({ queryKey: ['hunt', params.toString()], queryFn: () => api<HuntToken[]>(`/market/hunt?${params}`), refetchInterval: 20_000, enabled: !debounced });
  const search = useQuery({ queryKey: ['search', debounced], queryFn: () => api<PairSummary[]>(`/market/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 2 });

  const open = (chain: string, address: string) => router.push(`/t/${chain}/${address}`);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-start gap-5 p-3 md:p-6">
      <div className="flex min-w-0 flex-[999_1_720px] flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-[28px] font-semibold tracking-tight md:text-[32px]">Hunt</h1>
            <p className="text-sm text-muted">Find the next coin before everyone else — ranked by volume, momentum and how loud the room is.</p>
          </div>
          <label className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-line-2 bg-raised px-3.5 md:ml-auto md:w-[340px]">
            <Svg d={Icon.search} size={16} color="#8A93A6" />
            <span className="sr-only">Search coins</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a coin or paste a contract" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
          </label>
        </div>

        {!debounced && (
          <div className="flex items-center gap-2">
            <div className="scroll-thin min-w-0 flex-1 overflow-x-auto">
              <Segmented
                label="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'hot', label: 'Hot' },
                  { value: 'gainers', label: 'Gainers' },
                  { value: 'losers', label: 'Losers' },
                  { value: 'volume', label: 'Volume' },
                  { value: 'new', label: 'New' },
                ]}
              />
            </div>
            <FilterButton filter={filter} onClick={() => setFiltersOpen(true)} />
          </div>
        )}
        <FilterPanel open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Hunt" scope="hunt" value={filter} onApply={setFilter} countPath={`/market/hunt?sort=${sort}`} />

        {debounced ? (
          <section className="panel p-2">
            {search.data?.map((p) => (
              <button key={`${p.chain}:${p.baseToken.address}`} onClick={() => open(p.chain, p.baseToken.address)} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-hover">
                <Avatar name={p.baseToken.symbol} src={p.imageUrl} size={36} shape="circle" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{p.baseToken.symbol}</span>
                  <span className="truncate text-xs text-muted">{p.baseToken.name}</span>
                </span>
                <span className="num text-xs text-muted">{CHAIN_SHORT[p.chain]}</span>
                <span className="num w-24 text-right text-sm">{fmtUsd(p.marketCap ?? p.fdv)}</span>
                <span className="w-16 text-right text-xs">
                  <Delta value={p.priceChange24h} />
                </span>
              </button>
            ))}
            {search.data?.length === 0 && <Empty title="No coins found" />}
            {search.isLoading && <p className="p-4 text-sm text-muted">Searching…</p>}
          </section>
        ) : (
          <section aria-label="Coins" className="panel overflow-hidden">
            <div className="hidden md:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="label border-b border-line text-left">
                    <th className="w-10 py-3 pl-4 font-medium">#</th>
                    <th className="font-medium">Coin</th>
                    <th className="px-2.5 text-right font-medium">Price</th>
                    <th className="px-2.5 text-right font-medium">1h</th>
                    <th className="px-2.5 text-right font-medium">24h</th>
                    <th className="px-2.5 text-right font-medium">Mkt cap</th>
                    <th className="px-2.5 text-right font-medium">Volume</th>
                    <th className="px-2.5 text-right font-medium">Liq.</th>
                    <th className="pl-5 font-medium">Room</th>
                    <th className="font-medium">Risk</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data?.map((t, i) => (
                    <tr key={`${t.chain}:${t.address}`} onClick={() => open(t.chain, t.address)} className="cursor-pointer border-b border-[#151820] hover:bg-hover">
                      <td className="num py-3 pl-4 text-muted">{i + 1}</td>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={t.symbol} src={t.imageUrl} size={34} shape="circle" />
                          <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5 font-semibold">
                              {t.symbol}
                              <span className="num rounded border border-line-3 px-1 text-[9px] font-medium text-muted">{CHAIN_SHORT[t.chain]}</span>
                            </span>
                            <span className="max-w-[160px] truncate text-[11px] text-muted">
                              {t.name} · {fmtAge(t.createdAt)}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="num px-2.5 text-right">{t.priceUsd != null ? `$${fmtPrice(t.priceUsd)}` : '—'}</td>
                      <td className="px-2.5 text-right">
                        <Delta value={t.change1h} />
                      </td>
                      <td className="px-2.5 text-right">
                        <Delta value={t.change24h} />
                      </td>
                      <td className="num px-2.5 text-right">{fmtUsd(t.marketCapUsd)}</td>
                      <td className="num px-2.5 text-right">{fmtUsd(t.volumeUsd)}</td>
                      <td className="num px-2.5 text-right">{fmtUsd(t.liquidityUsd)}</td>
                      <td className="pl-5">
                        <span className="flex items-center gap-2">
                          <span className="flex items-center gap-1 rounded-md border border-violet-line bg-violet-dim px-1.5 text-[11px] text-violet-2">
                            <Svg d={Icon.chat} size={11} color="#B9AEFF" />
                            {t.chatCount}
                          </span>
                          {t.friendsBought.length > 0 && (
                            <span className="flex" title={`${t.friendsBought.map((f) => f.handle).join(', ')} bought`}>
                              {t.friendsBought.slice(0, 3).map((f) => (
                                <span key={f.userId} className="-mr-1.5">
                                  <Avatar name={f.handle} src={f.avatarUrl} size={20} shape="circle" ring="#0E1015" />
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <RiskTags risk={t.risk} />
                      </td>
                      <td className="pr-4 text-right">
                        <Link href={`/t/${t.chain}/${t.address}`} onClick={(e) => e.stopPropagation()} className="btn-lime h-8 px-3 text-xs">
                          Trade
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="flex flex-col md:hidden">
              {list.data?.map((t, i) => (
                <li key={`${t.chain}:${t.address}`}>
                  <button onClick={() => open(t.chain, t.address)} className="flex w-full items-center gap-3 border-b border-[#151820] px-3.5 py-3 text-left">
                    <span className="num w-5 text-xs text-muted">{i + 1}</span>
                    <Avatar name={t.symbol} src={t.imageUrl} size={38} shape="circle" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {t.symbol}
                        <span className="num rounded border border-line-3 px-1 text-[9px] font-medium text-muted">{CHAIN_SHORT[t.chain]}</span>
                        {t.chatCount > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-violet-2">
                            <Svg d={Icon.chat} size={10} color="#B9AEFF" />
                            {t.chatCount}
                          </span>
                        )}
                      </span>
                      <span className="num text-[11px] text-muted">
                        MC {fmtUsd(t.marketCapUsd)} · V {fmtUsd(t.volumeUsd)}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="num text-sm">{t.priceUsd != null ? `$${fmtPrice(t.priceUsd)}` : '—'}</span>
                      <span className="text-xs">
                        <Delta value={t.change24h} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {list.isLoading && <p className="p-6 text-sm text-muted">Loading coins…</p>}
            {list.data?.length === 0 && <Empty title="No coins match these filters">Loosen a filter or switch chains.</Empty>}
          </section>
        )}
      </div>

      <HuntRail loggedIn={!!me} />
    </div>
  );
}

interface FriendBuy {
  chain: string;
  address: string;
  symbol: string;
  buyers: { handle: string; avatarUrl: string | null }[];
  totalUsd: number;
}

function HuntRail({ loggedIn }: { loggedIn: boolean }) {
  const friends = useQuery({ queryKey: ['hunt-friends'], queryFn: () => api<FriendBuy[]>('/market/hunt/friends'), enabled: loggedIn, refetchInterval: 30_000 });
  const calls = useQuery({ queryKey: ['hunt-calls'], queryFn: () => api<(ChatMessageDTO & { group: { slug: string; name: string } })[]>('/market/hunt/calls'), refetchInterval: 30_000 });
  const leaders = useQuery({ queryKey: ['leaderboard', 30], queryFn: () => api<LeaderRow[]>('/copy/leaderboard?days=30'), staleTime: 60_000 });

  return (
    <aside aria-label="Signals" className="flex w-full flex-col gap-4 lg:w-[330px] lg:shrink-0">
      <section className="panel flex flex-col gap-2.5 p-4">
        <h2 className="text-[15px] font-semibold">Friends are buying</h2>
        {!loggedIn && <p className="text-xs text-muted">Log in and follow traders to see what they buy.</p>}
        {loggedIn && friends.data?.length === 0 && <p className="text-xs text-muted">Nobody you follow bought in the last 24h.</p>}
        {friends.data?.map((f) => (
          <Link key={`${f.chain}:${f.address}`} href={`/t/${f.chain}/${f.address}`} className="flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-hover">
            <Avatar name={f.symbol} size={32} shape="circle" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">{f.symbol}</span>
              <span className="truncate text-[11px] text-muted">
                {f.buyers[0].handle}
                {f.buyers.length > 1 ? ` +${f.buyers.length - 1}` : ''} bought · {fmtUsd(f.totalUsd)}
              </span>
            </span>
            <span className="flex">
              {f.buyers.slice(0, 3).map((b) => (
                <span key={b.handle} className="-ml-1.5">
                  <Avatar name={b.handle} src={b.avatarUrl} size={22} shape="circle" ring="#0E1015" />
                </span>
              ))}
            </span>
          </Link>
        ))}
      </section>

      <section className="panel flex flex-col gap-2.5 p-4">
        <div className="flex items-center">
          <h2 className="text-[15px] font-semibold">Fresh calls</h2>
          <Link href="/groups" className="ml-auto text-xs text-lime">
            Groups
          </Link>
        </div>
        {calls.data?.length === 0 && <p className="text-xs text-muted">No spot calls posted yet.</p>}
        {calls.data?.map((c) =>
          c.attachment?.kind === 'call' ? (
            <Link key={c.id} href={`/t/${c.attachment.chain}/${c.attachment.token.address}`} className="flex flex-col gap-1.5 rounded-xl border border-line-2 bg-raised p-3 hover:bg-hover">
              <span className="flex items-center gap-2">
                <span className="rounded-[5px] bg-lime px-1.5 py-0.5 text-[10px] font-semibold text-bg">CALL</span>
                <span className="num font-semibold">{c.attachment.token.symbol}</span>
                <span className="ml-auto text-[11px] text-muted">{fmtAge(c.createdAt)} ago</span>
              </span>
              <span className="num text-[11px] text-text-2">
                Buy {c.attachment.buyZone} · TP {c.attachment.target} · Invalid {c.attachment.invalidation}
              </span>
              <span className="text-[11px] text-muted">
                @{c.author.handle} in {c.group.name}
              </span>
            </Link>
          ) : null,
        )}
      </section>

      <section className="panel flex flex-col gap-2 p-4">
        <div className="flex items-center">
          <h2 className="text-[15px] font-semibold">Top hunters</h2>
          <Link href="/copy" className="ml-auto text-xs text-lime">
            Copy
          </Link>
        </div>
        {leaders.data?.slice(0, 4).map((t) => (
          <Link key={t.handle} href={`/u/${t.handle}`} className="flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-hover">
            <Avatar name={t.handle} src={t.avatarUrl} size={32} />
            <span className="flex flex-1 flex-col">
              <span className="text-sm font-semibold">{t.handle}</span>
              <span className="text-[11px] text-muted">{t.copiers} copiers</span>
            </span>
            <span className="text-xs">
              <Delta value={t.roiPct} />
            </span>
          </Link>
        ))}
      </section>
    </aside>
  );
}

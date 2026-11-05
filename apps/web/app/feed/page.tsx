'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CHAINS, fmtAge, fmtUsd, type ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useInstantTrade } from '@/lib/trade';
import { SocialTabs } from '@/components/header';
import { Avatar, Delta, Empty, Icon, Segmented, Svg } from '@/components/ui';

type Who = { handle: string; avatarUrl: string | null };
type Coin = { chain: ChainId; address: string; symbol: string; imageUrl: string | null; priceUsd: number | null; marketCapUsd: number | null; change24h: number | null };
type Item =
  | { kind: 'trade'; id: string; at: string; user: Who; side: 'buy' | 'sell'; amountUsd: number | null; source: string; coin: Coin }
  | { kind: 'call'; id: string; at: string; user: Who; group: { slug: string; name: string }; buyZone: string; target: string; invalidation: string; sinceCallPct: number | null; coin: Coin };

function BuySame({ coin }: { coin: Coin }) {
  const { run, busy, buyAmounts, native } = useInstantTrade({ chain: coin.chain, token: coin.address, symbol: coin.symbol });
  const amt = buyAmounts[1] ?? buyAmounts[0];
  if (!amt) return null;
  return (
    <button onClick={() => run('buy', amt)} disabled={!!busy} className="btn-lime h-9 px-3.5 text-xs">
      <Svg d={Icon.bolt} size={13} />
      {busy ? 'Buying…' : `Buy ${amt} ${native}`}
    </button>
  );
}

function CoinLine({ coin }: { coin: Coin }) {
  return (
    <Link href={`/t/${coin.chain}/${coin.address}`} className="flex items-center gap-2.5 rounded-xl border border-line-2 bg-raised px-3 py-2 hover:bg-hover">
      <Avatar name={coin.symbol} src={coin.imageUrl} size={28} shape="circle" />
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-semibold">
          ${coin.symbol} <span className="num text-[10px] font-normal text-muted">{CHAINS[coin.chain].name}</span>
        </span>
        <span className="num text-[11px] text-muted">MC {fmtUsd(coin.marketCapUsd)}</span>
      </span>
      <span className="ml-auto text-xs">
        <Delta value={coin.change24h} />
      </span>
    </Link>
  );
}

function Card({ it }: { it: Item }) {
  return (
    <article className="panel flex flex-col gap-3 p-4">
      <header className="flex items-center gap-2.5 text-[13px]">
        <Link href={`/u/${it.user.handle}`}>
          <Avatar name={it.user.handle} src={it.user.avatarUrl} size={34} />
        </Link>
        <span className="min-w-0 flex-1">
          <Link href={`/u/${it.user.handle}`} className="font-semibold hover:underline">
            @{it.user.handle}
          </Link>{' '}
          {it.kind === 'trade' ? (
            <span className="text-text-2">
              <span className={it.side === 'buy' ? 'text-lime' : 'text-down-2'}>{it.side === 'buy' ? 'bought' : 'sold'}</span> ${it.coin.symbol}
              {it.amountUsd != null && <span className="num"> · {fmtUsd(it.amountUsd, { compact: it.amountUsd >= 10_000 })}</span>}
              {it.source === 'copy' && <span className="text-muted"> · copied</span>}
            </span>
          ) : (
            <span className="text-text-2">
              called ${it.coin.symbol} in{' '}
              <Link href={`/groups/${it.group.slug}`} className="text-text hover:underline">
                {it.group.name}
              </Link>
            </span>
          )}
        </span>
        <time className="num shrink-0 text-[11px] text-faint" dateTime={it.at}>
          {fmtAge(it.at)}
        </time>
      </header>

      {it.kind === 'call' && (
        <div className="num grid grid-cols-3 gap-2 rounded-xl bg-raised p-3 text-xs">
          <span className="flex flex-col gap-0.5">
            <span className="font-sans text-[11px] text-muted">Buy zone</span>
            {it.buyZone}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-sans text-[11px] text-muted">Target</span>
            {it.target}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-sans text-[11px] text-muted">Invalid</span>
            {it.invalidation}
          </span>
        </div>
      )}

      <CoinLine coin={it.coin} />

      <footer className="flex items-center gap-2">
        {it.kind === 'call' && it.sinceCallPct != null && (
          <span className="text-xs text-muted">
            Since call <Delta value={it.sinceCallPct} />
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <Link href={`/t/${it.coin.chain}/${it.coin.address}`} className="btn-ghost h-9 px-3.5 text-xs">
            Chart
          </Link>
          <BuySame coin={it.coin} />
        </span>
      </footer>
    </article>
  );
}

export default function FeedPage() {
  const { me, login } = useSession();
  const [only, setOnly] = useState<'all' | 'trades' | 'calls'>('all');
  const feed = useInfiniteQuery({
    queryKey: ['feed', only],
    queryFn: ({ pageParam }) => api<{ items: Item[]; next: string | null }>(`/feed?only=${only}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: !!me,
    refetchInterval: 20_000,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <SocialTabs />
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4 p-3 md:p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-[28px] font-semibold tracking-tight md:text-[32px]">Feed</h1>
            <p className="text-sm text-muted">What the traders you follow are buying, and the calls in your groups.</p>
          </div>
          <span className="ml-auto">
            <Segmented
              label="Show"
              value={only}
              onChange={setOnly}
              options={[
                { value: 'all', label: 'All' },
                { value: 'trades', label: 'Trades' },
                { value: 'calls', label: 'Calls' },
              ]}
            />
          </span>
        </div>

        {!me ? (
          <Empty icon={Icon.chat} title="Log in to see your feed" action={<button className="btn-lime h-10 px-5" onClick={login}>Log in</button>}>
            Follow traders and join groups to fill it.
          </Empty>
        ) : feed.isLoading ? (
          <p className="p-4 text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <Empty
            icon={Icon.chat}
            title="Your feed is empty"
            action={
              <span className="flex gap-2">
                <Link href="/copy" className="btn-lime h-10 px-5">
                  Find traders
                </Link>
                <Link href="/groups" className="btn-ghost h-10 px-5">
                  Join groups
                </Link>
              </span>
            }
          >
            Follow traders and join groups. Their trades and calls show up here.
          </Empty>
        ) : (
          <>
            {items.map((it) => (
              <Card key={`${it.kind}:${it.id}`} it={it} />
            ))}
            {feed.hasNextPage && (
              <button className="btn-ghost h-10" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                {feed.isFetchingNextPage ? 'Loading…' : 'Show older'}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

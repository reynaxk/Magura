'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHAINS, fmtPrice, fmtUsd, roomIds, type ChainId, type PairSummary, type Timeframe, type TokenRisk } from '@magura/shared';
import { api } from '@/lib/api';
import { ChatPanel } from './chat-panel';
import { PriceChart, type ChartMarker } from './price-chart';
import { TradeTicket } from './trade-ticket';
import { InstantTrade } from './instant-trade';
import { CoinActivity } from './coin-activity';
import { PriceAlertButton } from './price-alerts';
import { Avatar, Delta, Flash, RiskTags, Segmented, Skeleton } from './ui';

interface TokenInfo {
  chain: ChainId;
  address: string;
  pair: PairSummary | null;
  token: { symbol: string; name: string; imageUrl: string | null; launchpad: string | null; bondingPct: number | null; pairAddress: string | null; priceUsd?: number | null; priceChange24h?: number | null; marketCapUsd?: number | null; volumeUsd?: number | null; liquidityUsd?: number | null } | null;
  risk: TokenRisk | null;
}

export interface LeaderRow {
  rank: number;
  handle: string;
  avatarUrl: string | null;
  roiPct: number | null;
  winRatePct: number | null;
  pnlUsd: number;
  copiers: number;
  trades: number;
}

export function Terminal({ chain, address, inDrawer = false }: { chain: ChainId; address: string; inDrawer?: boolean }) {
  const [tf, setTf] = useState<Timeframe>('15m');
  const [room, setRoom] = useState<'coin' | 'world'>('coin');
  const info = useQuery({
    queryKey: ['token', chain, address],
    queryFn: () => api<TokenInfo>(`/market/tokens/${chain}/${address}`),
    refetchInterval: 15_000,
  });
  const pair = info.data?.pair;
  const KNOWN: Record<string, string> = { So11111111111111111111111111111111111111112: 'SOL' };
  const symbol = pair?.baseToken.symbol ?? info.data?.token?.symbol ?? KNOWN[address] ?? (info.isError ? `${address.slice(0, 4)}…` : '…');
  const name = pair?.baseToken.name ?? info.data?.token?.name ?? '';
  const pool = pair?.pairAddress ?? info.data?.token?.pairAddress ?? null;
  const coinRoom = roomIds.coin(chain, address);
  const tok = info.data?.token;
  const friends = useQuery({
    queryKey: ['coin-friends', chain, address],
    queryFn: () => api<{ handle: string; side: 'buy' | 'sell'; at: string }[]>(`/market/tokens/${chain}/${address}/friends`),
    refetchInterval: 30_000,
  });
  const markers = useMemo<ChartMarker[]>(() => (friends.data ?? []).map((f) => ({ at: f.at, side: f.side, label: f.handle })), [friends.data]);

  return (
    <div className="flex min-h-app flex-wrap">
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4 p-3 md:p-5">
        <section aria-label="Chart" className="panel flex flex-col gap-3.5 p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-3">
              <Avatar name={symbol} src={pair?.imageUrl ?? info.data?.token?.imageUrl} size={40} shape="circle" />
              <div className="flex flex-col">
                <h1 className="text-lg font-semibold tracking-tight">
                  {symbol} <span className="text-xs font-medium text-muted">{CHAINS[chain].name} · Spot</span>
                </h1>
                <span className="text-xs text-muted">{name}</span>
              </div>
            </div>
            {info.isLoading ? (
              <Skeleton className="h-10 w-40" />
            ) : (
              <div className="flex flex-col">
                <span className="num -ml-1 text-[26px] font-semibold tracking-tight"><Flash value={pair?.priceUsd ?? tok?.priceUsd}>${fmtPrice(pair?.priceUsd ?? tok?.priceUsd)}</Flash></span>
                <span className="text-xs">
                  <Delta value={pair?.priceChange24h ?? tok?.priceChange24h} /> <span className="text-muted">24h</span>
                </span>
              </div>
            )}
            <dl className="flex gap-6 text-xs [&_dd]:font-mono [&_dt]:text-[11px]">
              {[
                ['Mkt cap', fmtUsd(pair?.marketCap ?? pair?.fdv ?? tok?.marketCapUsd)],
                ['24h Vol', fmtUsd(pair?.volume24h ?? tok?.volumeUsd)],
                ['Liquidity', fmtUsd(pair?.liquidityUsd ?? tok?.liquidityUsd)],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="ml-auto">
              <Segmented
                label="Timeframe"
                value={tf}
                onChange={setTf}
                options={(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((v) => ({ value: v, label: v.toUpperCase() }))}
              />
            </div>
          </div>
          {info.isError ? (
            <div className="flex h-[340px] flex-col items-center justify-center gap-2 rounded-[14px] border border-[#171A22] bg-bar text-center">
              <span className="text-sm font-semibold">Market data unavailable</span>
              <span className="max-w-sm text-[13px] text-muted">We couldn&apos;t reach the price feeds for this token. Chat and trading still work — retrying automatically.</span>
            </div>
          ) : (
            <PriceChart chain={chain} pool={pool} tf={tf} height={340} markers={markers} />
          )}
          <div className="flex items-center gap-3">
            <span className="label">Risk</span>
            <RiskTags risk={info.data?.risk ?? null} />
            <span className="ml-auto">
              {symbol !== '…' && (
                <PriceAlertButton chain={chain} token={address} symbol={symbol} priceUsd={pair?.priceUsd ?? tok?.priceUsd ?? null} mcUsd={pair?.marketCap ?? pair?.fdv ?? tok?.marketCapUsd ?? null} />
              )}
            </span>
            <a href={`${CHAINS[chain].explorer}/token/${address}`} target="_blank" rel="noreferrer" className="num text-xs text-muted hover:text-text">
              {address.slice(0, 6)}…{address.slice(-4)} ↗
            </a>
          </div>
        </section>
        <div className="flex flex-wrap gap-4">
          <div className="min-w-0 flex-[999_1_420px]">
            <CoinActivity chain={chain} address={address} />
          </div>
          <div className="flex flex-[1_1_280px] flex-col gap-4">
            {symbol !== '…' && <InstantTrade target={{ chain, token: address, symbol }} />}
            <TradeTicket chain={chain} token={address} symbol={symbol} mcUsd={pair?.marketCap ?? pair?.fdv ?? tok?.marketCapUsd ?? null} />
          </div>
          <Predictions symbol={symbol} />
        </div>
      </div>

      <aside aria-label="Live chat" className={`flex h-[75dvh] min-w-0 flex-[1_1_340px] flex-col border-t border-line bg-bar ${inDrawer ? 'lg:sticky lg:top-12 lg:h-[calc(100vh-49px)]' : 'lg:sticky lg:top-16 lg:h-auto lg:max-h-app'} lg:max-w-[380px] lg:border-l lg:border-t-0`}>
        <div role="tablist" aria-label="Chat rooms" className="flex gap-1 border-b border-line p-3">
          {[
            ['coin', `$${symbol}`],
            ['world', 'World'],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={room === id}
              onClick={() => setRoom(id as 'coin' | 'world')}
              className={`h-9 flex-1 rounded-[10px] border text-xs font-semibold ${room === id ? 'border-lime bg-lime text-bg' : 'border-line-2 bg-raised text-text-2'}`}
            >
              {label}
            </button>
          ))}
          <Link href="/groups" className="flex h-9 flex-1 items-center justify-center rounded-[10px] border border-line-2 bg-raised text-xs font-semibold text-text-2">
            Groups
          </Link>
          <Link href="/messages" className="flex h-9 flex-1 items-center justify-center rounded-[10px] border border-line-2 bg-raised text-xs font-semibold text-text-2">
            DMs
          </Link>
        </div>
        {room === 'coin' ? (
          <ChatPanel key={coinRoom} roomId={coinRoom} title={`$${symbol} room`} placeholder={`Talk ${symbol}…`} className="flex-1" />
        ) : (
          <ChatPanel key="world" roomId="world" title="World chat" placeholder="Say hi to the world" className="flex-1" />
        )}
      </aside>

      {!inDrawer && <SocialRail />}
    </div>
  );
}

function Predictions({ symbol }: { symbol: string }) {
  const q = useQuery({
    queryKey: ['predictions', symbol],
    queryFn: () => api<{ id: string; question: string; url: string; yesPrice: number | null }[]>(`/market/predictions?q=${encodeURIComponent(symbol.toLowerCase())}`),
    staleTime: 120_000,
  });
  if (!q.data?.length) return null;
  return (
    <section aria-label="Predictions" className="panel flex min-w-0 flex-[999_1_380px] flex-col gap-3 p-[18px]">
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold">Predictions</span>
        <span className="text-xs text-muted">from Polymarket</span>
      </div>
      {(
        <ul className="flex flex-col">
          {q.data.slice(0, 4).map((m) => (
            <li key={m.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <a href={m.url} target="_blank" rel="noreferrer" className="flex-1 text-[13px] text-text-2 hover:text-text">
                {m.question}
              </a>
              <span className="num text-sm font-semibold text-lime">{m.yesPrice != null ? `${Math.round(m.yesPrice * 100)}%` : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SocialRail() {
  const leaders = useQuery({ queryKey: ['leaderboard', 30], queryFn: () => api<LeaderRow[]>('/copy/leaderboard?days=30'), staleTime: 60_000 });
  const streams = useQuery({
    queryKey: ['streams'],
    queryFn: () => api<{ id: string; title: string; viewers: number; host: { handle: string; avatarUrl: string | null } }[]>('/streams'),
    refetchInterval: 30_000,
  });
  return (
    <aside aria-label="Social" className="hidden min-w-0 flex-[1_1_300px] flex-col gap-5 border-l border-line bg-bar p-4 xl:flex xl:max-w-[340px]">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center">
          <span className="text-[15px] font-semibold">Top traders to copy</span>
          <Link href="/copy" className="ml-auto text-xs text-lime">
            See all
          </Link>
        </div>
        {leaders.data?.slice(0, 3).map((t) => (
          <Link key={t.handle} href={`/u/${t.handle}`} className="card flex items-center gap-2.5 p-3 hover:bg-hover">
            <Avatar name={t.handle} src={t.avatarUrl} size={36} />
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{t.handle}</span>
              <span className="text-[11px] text-muted">{t.copiers} copiers</span>
            </span>
            <span className="ml-auto text-xs">
              <Delta value={t.roiPct} />
            </span>
          </Link>
        ))}
        {leaders.data?.length === 0 && <span className="text-xs text-muted">Leaderboard fills as traders trade.</span>}
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">Live now</span>
          {!!streams.data?.length && <span className="rounded bg-live px-1.5 py-0.5 text-[10px] font-semibold text-white">{streams.data.length} LIVE</span>}
        </div>
        {streams.data?.slice(0, 4).map((s) => (
          <Link key={s.id} href={`/live/${s.id}`} className="card flex items-center gap-2.5 p-3 hover:bg-hover">
            <Avatar name={s.host.handle} src={s.host.avatarUrl} size={32} ring="#E5354B" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-semibold">{s.title}</span>
              <span className="text-[11px] text-muted">
                @{s.host.handle} · {s.viewers} watching
              </span>
            </span>
          </Link>
        ))}
        {streams.data?.length === 0 && <span className="text-xs text-muted">Nobody is live right now.</span>}
      </div>
      <Link href="/groups" className="flex flex-col gap-2 rounded-2xl border border-violet-line bg-violet-dim p-3.5">
        <span className="text-sm font-semibold">Voice rooms</span>
        <span className="text-xs text-violet-2">Jump into a group's main desk to trade together.</span>
      </Link>
    </aside>
  );
}

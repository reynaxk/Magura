'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHAINS, fmtPrice, fmtUsd, roomIds, type ChainId, type PairSummary, type Timeframe, type TokenIntel, type TokenRisk } from '@magura/shared';
import { api } from '@/lib/api';
import { ChatPanel } from './chat-panel';
import { PriceChart, type ChartLine, type ChartMarker } from './price-chart';
import { useSession } from '@/lib/session';
import { TradeTicket } from './trade-ticket';
import { InstantTrade } from './instant-trade';
import { CoinActivity } from './coin-activity';
import { SupplySplit } from './supply-split';
import { PriceAlertButton } from './price-alerts';
import { Avatar, Delta, Flash, Icon, Segmented, Skeleton, Svg } from './ui';

interface TokenInfo {
  chain: ChainId;
  address: string;
  pair: PairSummary | null;
  token: {
    symbol: string;
    name: string;
    imageUrl: string | null;
    launchpad: string | null;
    bondingPct: number | null;
    pairAddress: string | null;
    priceUsd?: number | null;
    priceChange24h?: number | null;
    marketCapUsd?: number | null;
    volumeUsd?: number | null;
    liquidityUsd?: number | null;
    creator?: string | null;
    intel?: TokenIntel | null;
    devSoldAt?: string | null;
  } | null;
  risk: TokenRisk | null;
  dex: { paid: boolean; cto: boolean; kinds: string[] } | null;
  sameName: { chain: string; address: string; symbol: string; name: string; imageUrl: string | null; marketCapUsd: number | null; createdAt: string }[];
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
  // dev + your own trades come from the labelled trade feed (shared cache with the Trades tab)
  const coinTrades = useQuery({
    queryKey: ['coin-trades', chain, address, 0],
    queryFn: () => api<{ side: 'buy' | 'sell'; at: string; tags: string[] }[]>(`/market/tokens/${chain}/${address}/trades?min=0`),
    refetchInterval: 8_000,
  });
  const [show, setShow] = useState({ friends: true, dev: true, you: true });
  const markers = useMemo<ChartMarker[]>(() => {
    const out: ChartMarker[] = [];
    if (show.friends) for (const f of friends.data ?? []) out.push({ at: f.at, side: f.side, label: f.handle, kind: 'friend' });
    for (const t of coinTrades.data ?? []) {
      if (show.dev && t.tags.includes('dev')) out.push({ at: t.at, side: t.side, label: `DEV ${t.side === 'buy' ? 'B' : 'S'}`, kind: 'dev' });
      else if (show.you && t.tags.includes('you')) out.push({ at: t.at, side: t.side, label: 'YOU', kind: 'you' });
    }
    return out;
  }, [friends.data, coinTrades.data, show]);

  const { me } = useSession();
  const position = useQuery({
    queryKey: ['position', chain, address],
    queryFn: () => api<{ open: boolean; avgPriceUsd: number | null }>(`/me/position/${chain}/${address}`),
    enabled: !!me,
    refetchInterval: 30_000,
  });
  const lines: ChartLine[] = position.data?.open && position.data.avgPriceUsd ? [{ price: position.data.avgPriceUsd, label: 'Your entry', color: '#E9ECF2' }] : [];
  const mc = pair?.marketCap ?? pair?.fdv ?? tok?.marketCapUsd ?? null;
  const price = pair?.priceUsd ?? tok?.priceUsd ?? null;
  const intel = tok?.intel ?? null;
  const risk = info.data?.risk ?? null;

  return (
    <div className="flex min-h-app">
      <div className="flex min-w-0 flex-1 flex-col">
        <CoinHeader
          chain={chain}
          address={address}
          symbol={symbol}
          name={name}
          image={pair?.imageUrl ?? tok?.imageUrl ?? null}
          price={price}
          change24h={pair?.priceChange24h ?? tok?.priceChange24h ?? null}
          mc={mc}
          liq={pair?.liquidityUsd ?? tok?.liquidityUsd ?? null}
          vol={pair?.volume24h ?? tok?.volumeUsd ?? null}
          holders={intel?.holders ?? risk?.holders ?? null}
          bonding={tok?.bondingPct ?? null}
          ath={(tok as { athMarketCapUsd?: number | null } | null)?.athMarketCapUsd ?? null}
          created={pair?.pairCreatedAt ?? (tok as { createdAt?: string } | null)?.createdAt ?? null}
          links={pair?.links ?? []}
          dex={info.data?.dex ?? null}
          loading={info.isLoading}
        />
        <div className="flex min-w-0 flex-1 flex-wrap">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3 p-3">
            <section aria-label="Chart" className="panel flex flex-col gap-2.5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  label="Timeframe"
                  value={tf}
                  onChange={setTf}
                  options={(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((v) => ({ value: v, label: v.toUpperCase() }))}
                />
                <span className="mx-1 h-5 w-px bg-line-2" />
                {(
                  [
                    ['friends', 'Friends', '#2FE39A'],
                    ['dev', 'Dev', '#F5A64A'],
                    ['you', 'You', '#E9ECF2'],
                  ] as const
                ).map(([k, label, color]) => (
                  <button
                    key={k}
                    aria-pressed={show[k]}
                    onClick={() => setShow((v) => ({ ...v, [k]: !v[k] }))}
                    className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold ${show[k] ? 'border-line-3 bg-raised text-text' : 'border-line-2 text-faint'}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: show[k] ? color : '#2A303C' }} />
                    {label}
                  </button>
                ))}
                <span className="ml-auto">{symbol !== '…' && <PriceAlertButton chain={chain} token={address} symbol={symbol} priceUsd={price} mcUsd={mc} />}</span>
              </div>
              {info.isError ? (
                <div className="flex h-[440px] flex-col items-center justify-center gap-2 rounded-[14px] border border-[#171A22] bg-bar text-center">
                  <span className="text-sm font-semibold">Market data unavailable</span>
                  <span className="max-w-sm text-[13px] text-muted">We couldn&apos;t reach the price feeds. Chat and trading still work — retrying automatically.</span>
                </div>
              ) : (
                <PriceChart chain={chain} pool={pool} tf={tf} height={440} markers={markers} lines={lines} />
              )}
            </section>
            <CoinActivity chain={chain} address={address} creator={tok?.creator ?? null} />
          </div>

          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 p-3 lg:max-w-[360px] lg:pl-0">
            <ChangeStrip pair={pair ?? null} />
            <TradeTicket chain={chain} token={address} symbol={symbol} mcUsd={mc} />
            {symbol !== '…' && <InstantTrade target={{ chain, token: address, symbol }} />}
            <RiskGrid intel={intel} risk={risk} dex={info.data?.dex ?? null} />
            {(intel || risk) && (
              <section aria-label="Supply split" className="panel p-4">
                <SupplySplit intel={intel} risk={risk} />
              </section>
            )}
            <InfoCard
              title="Pool"
              rows={[
                ['DEX', pair?.dex ?? tok?.launchpad ?? '—'],
                ['Liquidity', fmtUsd(pair?.liquidityUsd ?? tok?.liquidityUsd)],
                ['Pair', pool ? <CopyText key="p" text={pool} /> : '—'],
                ['Created', pair?.pairCreatedAt ? new Date(pair.pairCreatedAt).toLocaleString() : '—'],
              ]}
            />
            <DevCard chain={chain} creator={tok?.creator ?? null} devPct={intel?.devPct ?? risk?.devPct ?? null} soldAll={!!intel?.devSoldAll || !!tok?.devSoldAt} />
            <SameName chain={chain} items={info.data?.sameName ?? []} />
          </div>
        </div>
      </div>

      <aside
        aria-label="Live chat"
        className={`hidden min-w-0 w-[320px] shrink-0 flex-col border-l border-line bg-bar 2xl:flex ${inDrawer ? 'sticky top-12 h-[calc(100vh-49px)]' : 'sticky top-16 h-[calc(100vh-64px-30px)]'}`}
      >
        <div role="tablist" aria-label="Chat rooms" className="flex gap-1 border-b border-line p-2.5">
          {[
            ['coin', `$${symbol}`],
            ['world', 'World'],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={room === id}
              onClick={() => setRoom(id as 'coin' | 'world')}
              className={`h-8 flex-1 rounded-lg text-xs font-semibold ${room === id ? 'bg-lime text-bg' : 'bg-raised text-text-2'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {room === 'coin' ? (
          <ChatPanel key={coinRoom} roomId={coinRoom} title={`$${symbol} room`} placeholder={`Talk ${symbol}…`} className="min-h-0 flex-1" />
        ) : (
          <ChatPanel key="world" roomId="world" title="World chat" placeholder="Say hi to the world" className="min-h-0 flex-1" />
        )}
      </aside>
    </div>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return null;
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="num text-text-2 hover:text-lime"
      title="Copy"
    >
      {done ? 'Copied' : `${text.slice(0, 4)}…${text.slice(-4)}`}
    </button>
  );
}

const LINK_ICON: Record<string, string> = { twitter: 'M4 4l16 16M20 4L4 20', telegram: 'M21 4L3 11l6 2 2 6 3-4 5 4z', website: Icon.globe };

function CoinHeader(p: {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  change24h: number | null;
  mc: number | null;
  liq: number | null;
  vol: number | null;
  holders: number | null;
  bonding: number | null;
  ath: number | null;
  created: string | null;
  links: { type: string; url: string }[];
  dex: { paid: boolean; cto: boolean } | null;
  loading: boolean;
}) {
  const stats: [string, React.ReactNode][] = [
    ['Market cap', fmtUsd(p.mc)],
    ['Liquidity', fmtUsd(p.liq)],
    ['24h vol', fmtUsd(p.vol)],
    ['Holders', p.holders != null ? p.holders.toLocaleString() : '—'],
  ];
  if (p.bonding != null && p.bonding < 100) stats.push(['Bonding', `${p.bonding.toFixed(1)}%`]);
  if (p.ath) stats.push(['ATH MC', fmtUsd(p.ath)]);
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-bar px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={p.symbol} src={p.image} size={42} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-[17px] font-semibold tracking-tight">{p.symbol}</h1>
            <span className="truncate text-xs text-muted">{p.name}</span>
            {p.dex?.paid && <span className="rounded bg-sky/15 px-1.5 text-[10px] font-bold text-sky">DEX PAID</span>}
            {p.dex?.cto && <span className="rounded bg-violet-dim px-1.5 text-[10px] font-bold text-violet-2">CTO</span>}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-faint">
            <span className="num text-lime">{ago(p.created) ?? '—'}</span>
            <CopyText text={p.address} />
            <span className="uppercase">{CHAINS[p.chain].name}</span>
            {p.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" title={l.type} className="text-muted hover:text-text">
                <Svg d={LINK_ICON[l.type] ?? Icon.globe} size={12} />
              </a>
            ))}
            <a href={`${CHAINS[p.chain].explorer}/token/${p.address}`} target="_blank" rel="noreferrer" className="hover:text-text">
              Explorer ↗
            </a>
            <a
              href={`https://app.bubblemaps.io/${{ solana: 'sol', base: 'base', bsc: 'bsc', ethereum: 'eth' }[p.chain]}/token/${p.address}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-text"
              title="See how holders are connected"
            >
              Bubblemap ↗
            </a>
          </div>
        </div>
      </div>
      {p.loading ? (
        <Skeleton className="h-9 w-40" />
      ) : (
        <div className="flex flex-col leading-tight">
          <span className="num text-[22px] font-semibold tracking-tight">
            <Flash value={p.price}>${fmtPrice(p.price)}</Flash>
          </span>
          <span className="text-[11px]">
            <Delta value={p.change24h} /> <span className="text-muted">24h</span>
          </span>
        </div>
      )}
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        {stats.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-[10.5px] text-muted">{k}</dt>
            <dd className="num text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

/** 5m / 1h / 6h / 24h change + 24h buy/sell counts — the strip above the trade box. */
function ChangeStrip({ pair }: { pair: PairSummary | null }) {
  const cells: [string, number | null | undefined][] = [
    ['5m', pair?.priceChange5m],
    ['1h', pair?.priceChange1h],
    ['6h', pair?.priceChange6h],
    ['24h', pair?.priceChange24h],
  ];
  const b = pair?.buys24h ?? null;
  const s = pair?.sells24h ?? null;
  const total = (b ?? 0) + (s ?? 0);
  return (
    <section aria-label="Price change" className="panel flex flex-col gap-2.5 p-3">
      <div className="grid grid-cols-4 gap-1.5">
        {cells.map(([k, v]) => (
          <div key={k} className="flex flex-col items-center gap-0.5 rounded-lg bg-raised py-1.5">
            <span className="text-[10px] text-muted">{k}</span>
            <span className="text-[12px]">
              <Delta value={v ?? null} />
            </span>
          </div>
        ))}
      </div>
      {total > 0 && (
        <div className="flex flex-col gap-1">
          <div className="num flex justify-between text-[10.5px]">
            <span className="text-lime">{b?.toLocaleString()} buys</span>
            <span className="text-muted">24h</span>
            <span className="text-down-2">{s?.toLocaleString()} sells</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-down/60">
            <span className="h-full bg-lime" style={{ width: `${((b ?? 0) / total) * 100}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

/** GMGN-style audit grid: one glance tells you if the coin is rigged. */
function RiskGrid({ intel, risk, dex }: { intel: TokenIntel | null; risk: TokenRisk | null; dex: { paid: boolean; cto: boolean } | null }) {
  const pct = (v: number | null | undefined, warn: number) => ({ text: v == null ? '—' : `${v.toFixed(v < 10 ? 1 : 0)}%`, bad: v != null && v > warn, good: v === 0 });
  const yes = (v: boolean | null | undefined, goodWhen: boolean) => ({
    text: v == null ? '—' : v === goodWhen ? 'Yes' : 'No',
    bad: v != null && v !== goodWhen,
    good: v === goodWhen,
  });
  const cells: { k: string; v: { text: string; bad: boolean; good: boolean } }[] = [
    { k: 'Top 10', v: pct(intel?.top10Pct ?? risk?.top10Pct, 30) },
    { k: 'Dev', v: pct(intel?.devPct ?? risk?.devPct, 10) },
    { k: 'Snipers', v: pct(intel?.sniperPct ?? risk?.sniperPct, 10) },
    { k: 'Bundlers', v: pct(intel?.bundlerPct, 10) },
    { k: 'Insiders', v: pct(intel?.insiderPct, 10) },
    { k: 'Fresh', v: pct(intel?.freshPct, 20) },
    { k: 'No mint', v: yes(risk?.mintable == null ? null : !risk.mintable, true) },
    { k: 'No freeze', v: yes(risk?.freezable == null ? null : !risk.freezable, true) },
    { k: 'Honeypot', v: yes(risk?.honeypot, false) },
    {
      k: 'Buy / sell tax',
      v: { text: risk?.buyTax != null ? `${risk.buyTax}/${risk.sellTax ?? 0}%` : '—', bad: (risk?.sellTax ?? 0) > 10, good: risk?.buyTax === 0 && risk?.sellTax === 0 },
    },
    { k: 'Dex paid', v: { text: dex == null ? '—' : dex.paid ? 'Paid' : 'No', bad: false, good: !!dex?.paid } },
    {
      k: 'Dev sold',
      v: { text: intel ? (intel.devSoldAll ? 'All' : intel.devSoldPct ? `${intel.devSoldPct}%` : 'No') : '—', bad: !!intel?.devSoldAll, good: !!intel && intel.devSoldPct === 0 },
    },
  ];
  return (
    <section aria-label="Audit" className="panel grid grid-cols-3 gap-1.5 p-3">
      {cells.map((c) => (
        <div key={c.k} className="flex flex-col gap-0.5 rounded-lg bg-raised px-2 py-1.5">
          <span className="text-[10px] text-muted">{c.k}</span>
          <span className={`num text-[12px] font-semibold ${c.v.bad ? 'text-down-2' : c.v.good ? 'text-lime' : 'text-text'}`}>{c.v.text}</span>
        </div>
      ))}
    </section>
  );
}

function InfoCard({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <section aria-label={title} className="panel flex flex-col gap-1.5 p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{title}</span>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 text-[12px]">
          <span className="text-muted">{k}</span>
          <span className="num truncate text-right text-text-2">{v}</span>
        </div>
      ))}
    </section>
  );
}

function DevCard({ chain, creator, devPct, soldAll }: { chain: ChainId; creator: string | null; devPct: number | null; soldAll: boolean }) {
  const q = useQuery({
    queryKey: ['dev-report', chain, creator],
    queryFn: () =>
      api<{ launched: number; migrated: number; migratedPct: number; quickRugs: number; best: { symbol: string; athMarketCapUsd: number | null } | null }>(
        `/market/dev/${chain}/${creator}`,
      ),
    enabled: !!creator,
    staleTime: 30_000,
  });
  if (!creator) return null;
  const d = q.data;
  return (
    <InfoCard
      title="Dev"
      rows={[
        ['Wallet', <CopyText key="c" text={creator} />],
        ['Holds', soldAll ? <span className="text-down-2">Sold all</span> : devPct != null ? `${devPct.toFixed(1)}%` : '—'],
        ['Coins launched', d ? String(d.launched) : '—'],
        ['Bonded', d ? `${d.migrated} (${d.migratedPct}%)` : '—'],
        ['Dumped in 1h', d ? <span className={d.quickRugs >= 2 ? 'text-down-2' : ''}>{d.quickRugs}</span> : '—'],
        ['Best coin', d?.best?.athMarketCapUsd ? `${d.best.symbol} · ${fmtUsd(d.best.athMarketCapUsd)}` : '—'],
      ]}
    />
  );
}

function SameName({
  chain,
  items,
}: {
  chain: ChainId;
  items: { chain: string; address: string; symbol: string; name: string; imageUrl: string | null; marketCapUsd: number | null; createdAt: string }[];
}) {
  if (!items.length) return null;
  return (
    <section aria-label="Same name coins" className="panel flex flex-col gap-1 p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Same name</span>
      {items.map((t) => (
        <Link key={`${t.chain}:${t.address}`} href={`/t/${t.chain}/${t.address}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-hover">
          <Avatar name={t.symbol} src={t.imageUrl} size={22} />
          <span className="min-w-0 flex-1 truncate text-[12px]">
            <span className="font-semibold">{t.symbol}</span> <span className="text-muted">{t.name}</span>
          </span>
          <span className="num text-[11px] text-text-2">{fmtUsd(t.marketCapUsd)}</span>
          <span className="num text-[10px] text-faint">{ago(t.createdAt)}</span>
        </Link>
      ))}
      <span className="text-[10.5px] text-faint">Check you&apos;re on the right {chain === 'solana' ? 'mint' : 'contract'} — copycats are common.</span>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { CHAINS, activeFilterCount, fmtAge, fmtUsd, roomIds, type CoinFilter, type SwapTx, type TrenchStage, type TrenchToken } from '@magura/shared';
import { FilterButton, FilterPanel, useStoredFilter } from '@/components/filter-panel';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { ChatPanel } from '@/components/chat-panel';
import { toast } from '@/components/toaster';
import { Avatar, Icon, Svg } from '@/components/ui';
import { TrenchCard } from '@/components/trench-card';
import { TrenchCustomize } from '@/components/trench-customize';
import { useTrenchPrefs } from '@/lib/trench-prefs';
import { soundFor } from '@/lib/sounds';
import { SupplySplit } from '@/components/supply-split';
import { TrenchRow } from '@/components/trench-row';
import { ProSidebar } from '@/components/pro-sidebar';
import { useUiPrefs } from '@/lib/ui-prefs';

const STAGES: { id: TrenchStage; title: string; hint: string; accent: string }[] = [
  { id: 'new', title: 'New Pairs', hint: 'just launched', accent: '#8FC6E6' },
  { id: 'almost', title: 'Almost Survived', hint: 'close to bonding', accent: '#FFC66B' },
  { id: 'survived', title: 'Survived', hint: 'migrated to DEX', accent: '#2FE39A' },
];

export default function TrenchesPage() {
  const socket = useSocket();
  const qc = useQueryClient();
  const { me, login, addressFor, sendSwap } = useSession();
  const [fNew, setFNew] = useStoredFilter('trenches-new');
  const [fAlmost, setFAlmost] = useStoredFilter('trenches-almost');
  const [fSurvived, setFSurvived] = useStoredFilter('trenches-survived');
  const filters: Record<TrenchStage, [CoinFilter, (f: CoinFilter) => void]> = { new: [fNew, setFNew], almost: [fAlmost, setFAlmost], survived: [fSurvived, setFSurvived] };
  const [filterFor, setFilterFor] = useState<TrenchStage | null>(null);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<TrenchToken | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [mobileStage, setMobileStage] = useState<TrenchStage>('new');
  const [prefs, setPrefs] = useTrenchPrefs();
  const [ui, setUi] = useUiPrefs();
  const pro = ui.layout === 'pro';
  const [customizing, setCustomizing] = useState(false);
  const router = useRouter();
  const pick = (t: TrenchToken) => {
    // phones: open the token page (chart + room); desktop: side panel unless they chose "open chart"
    if (prefs.click === 'page' || (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)) router.push(`/t/${t.chain}/${t.address}`);
    else setSelected(t);
  };
  const amountFor = (t: TrenchToken) => ((me?.settings?.quickBuyAmounts ?? {}) as Record<string, string>)[t.chain] ?? '0.1';
  const [, tick] = useState(0);
  const keyOf = (stage: TrenchStage) => JSON.stringify(filters[stage][0]);
  const allChains = [...new Set([...fNew.chains, ...fAlmost.chains, ...fSurvived.chains])];

  const results = useQueries({
    queries: STAGES.map((s) => ({
      queryKey: ['trenches', s.id, keyOf(s.id)],
      queryFn: () => api<TrenchToken[]>(`/market/trenches?stage=${s.id}&limit=40&f=${encodeURIComponent(keyOf(s.id))}`),
      refetchInterval: paused ? false : 20_000,
    })),
  });

  useEffect(() => {
    socket?.emit('trenches:subscribe', allChains);
  }, [socket, allChains.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ages tick every second
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Live updates. Columns with only a chain filter update instantly; columns with
  // more rules refetch so the server applies them.
  const simple = (stage: TrenchStage) => activeFilterCount({ ...filters[stage][0], chains: ['solana', 'base', 'bsc', 'ethereum'] }) === 0;
  useSocketEvent('trenches:token', (t) => {
    if (paused || !filters[t.stage][0].chains.includes(t.chain)) return;
    if (!simple(t.stage)) return void qc.invalidateQueries({ queryKey: ['trenches', t.stage] });
    qc.setQueryData<TrenchToken[]>(['trenches', t.stage, keyOf(t.stage)], (xs = []) => [t, ...xs.filter((x) => x.address !== t.address)].slice(0, 60));
  });
  useSocketEvent('trenches:update', (u) => {
    if (paused) return;
    for (const s of STAGES) {
      qc.setQueryData<TrenchToken[]>(['trenches', s.id, keyOf(s.id)], (xs) => {
        if (!xs) return xs;
        const found = xs.find((x) => x.address === u.address);
        if (!found) return xs;
        const merged = { ...found, ...u } as TrenchToken;
        if (u.stage && u.stage !== s.id) {
          const to = u.stage as TrenchStage;
          if (simple(to)) qc.setQueryData<TrenchToken[]>(['trenches', to, keyOf(to)], (ys = []) => [merged, ...ys.filter((y) => y.address !== u.address)]);
          else qc.invalidateQueries({ queryKey: ['trenches', to] });
          return xs.filter((x) => x.address !== u.address);
        }
        return xs.map((x) => (x.address === u.address ? merged : x));
      });
    }
  });

  async function quickBuy(t: TrenchToken, amountOverride?: string) {
    if (!me) return login();
    const wallet = addressFor(t.chain);
    if (!wallet) return toast({ title: 'No wallet', body: `Connect a ${CHAINS[t.chain].name} wallet` });
    const amount = amountOverride ?? amountFor(t);
    setBuying(t.address);
    try {
      const q = await api<{ quoteId: string }>('/swap/quote', { body: { chain: t.chain, side: 'buy', token: t.address, amount, slippageBps: 1500, wallet } });
      const tx = await api<SwapTx>('/swap/build', { body: { quoteId: q.quoteId } });
      const txHash = await sendSwap(tx);
      soundFor('buy');
      await api('/trades', {
        body: { quoteId: q.quoteId, chain: t.chain, side: 'buy', tokenAddress: t.address, tokenSymbol: t.symbol, txHash, shareToRoom: true, source: 'quickbuy' },
      });
      toast({ title: `Bought ${t.symbol}`, body: `${amount} ${CHAINS[t.chain].nativeSymbol} · confirming`, tone: 'lime' });
    } catch (e) {
      const msg = (e as Error).message;
      toast({
        title: /gas/i.test(msg) ? 'Not enough for gas' : msg.startsWith('min_trade') ? 'Trade too small' : 'Quick buy failed',
        body: msg.startsWith('min_trade') ? 'The minimum trade on Magura is $2' : msg,
      });
    } finally {
      setBuying(null);
    }
  }

  // keep the side panel live: prefer the fresh copy from the columns
  const live = selected ? results.flatMap((r) => r.data ?? []).find((x) => x.address === selected.address) : null;
  const sel = live ?? selected ?? results[1].data?.[0] ?? results[0].data?.[0] ?? null;

  return (
    <div className="flex min-h-app flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-[22px] font-semibold tracking-tight">Trenches</h1>
        <button
          onClick={() => setPaused((p) => !p)}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${paused ? 'border-[#4A3A1E] text-amber' : 'border-lime-line bg-lime-dim text-lime'}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-amber' : 'bg-lime'}`} />
          {paused ? 'Paused' : 'Live'}
        </button>
        <span className="ml-auto hidden items-center gap-2 rounded-xl border border-line-2 bg-raised px-3 py-2 text-xs text-muted xl:flex">
          <Svg d={Icon.bolt} size={14} color="#2FE39A" /> Quick buy amounts live in{' '}
          <Link href="/settings" className="text-lime">
            Settings
          </Link>
        </span>
        <div role="group" aria-label="Layout" className="ml-auto flex rounded-xl border border-line-2 bg-raised p-0.5 xl:ml-0">
          {(['clean', 'pro'] as const).map((l) => (
            <button
              key={l}
              aria-pressed={ui.layout === l}
              onClick={() => setUi({ ...ui, layout: l })}
              className={`h-8 rounded-[9px] px-3 text-xs font-semibold capitalize ${ui.layout === l ? 'bg-text text-bg' : 'text-muted hover:text-text'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCustomizing(true)}
          className="flex h-9 items-center gap-2 rounded-xl border border-line-2 bg-raised px-3 text-xs font-semibold text-text-2 hover:text-text xl:ml-0"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" />
          </svg>
          Customize
        </button>
      </div>
      <TrenchCustomize open={customizing} onClose={() => setCustomizing(false)} value={prefs} onChange={setPrefs} />

      <div className="flex items-center gap-2 border-b border-line bg-bar p-2 lg:hidden">
        <div role="tablist" aria-label="Stage" className="grid flex-1 grid-cols-3 gap-1">
          {STAGES.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={mobileStage === s.id}
              onClick={() => setMobileStage(s.id)}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-[10px] text-xs font-semibold ${mobileStage === s.id ? 'bg-text text-bg' : 'text-text-2'}`}
            >
              <span className="h-2 w-2 rounded-[3px]" style={{ background: s.accent }} />
              {s.id === 'almost' ? 'Almost' : s.title}
            </button>
          ))}
        </div>
        <FilterButton compact filter={filters[mobileStage][0]} onClick={() => setFilterFor(mobileStage)} />
      </div>
      {filterFor && (
        <FilterPanel
          open
          onClose={() => setFilterFor(null)}
          title={STAGES.find((x) => x.id === filterFor)!.title}
          scope={`trenches-${filterFor}`}
          value={filters[filterFor][0]}
          onApply={filters[filterFor][1]}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-wrap">
        {pro && <ProSidebar />}
        <div
          className={`grid min-w-0 flex-[999_1_820px] ${pro ? 'grid-cols-[repeat(auto-fit,minmax(330px,1fr))]' : 'grid-cols-[repeat(auto-fit,minmax(300px,1fr))]'}`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {STAGES.map((s, i) => (
            <section key={s.id} aria-label={s.title} className={`min-w-0 flex-col border-line lg:flex lg:border-r ${mobileStage === s.id ? 'flex' : 'hidden'}`}>
              <div className="hidden items-center gap-2.5 border-b border-line bg-bar px-4 py-3.5 lg:flex">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.accent }} />
                <h2 className="text-[15px] font-semibold">{s.title}</h2>
                <span className="ml-auto text-[11px] text-muted">{s.hint}</span>
                <FilterButton compact filter={filters[s.id][0]} onClick={() => setFilterFor(s.id)} />
              </div>
              <div className={`scroll-thin flex flex-col lg:max-h-[calc(100vh-190px)] lg:overflow-y-auto ${pro ? '' : 'gap-2 p-2.5'}`}>
                {results[i].isLoading &&
                  Array.from({ length: 5 }).map((_, k) => <div key={k} className={`${pro ? 'h-[62px] border-b border-line' : 'h-[118px] rounded-2xl'} animate-pulse bg-panel`} />)}
                {results[i].data?.length === 0 && <p className="p-6 text-center text-sm text-muted">Nothing here yet — tokens stream in live.</p>}
                {results[i].data
                  ?.filter((t) => !(prefs.hideDevSold && (t.devSold || t.intel?.devSoldAll)))
                  .map((t) =>
                    pro ? (
                      <TrenchRow
                        key={`${t.chain}:${t.address}`}
                        t={t}
                        accent={s.accent}
                        prefs={prefs}
                        amount={amountFor(t)}
                        onOpen={() => router.push(`/t/${t.chain}/${t.address}`)}
                        onBuy={(amt) => quickBuy(t, amt)}
                        buying={buying === t.address}
                      />
                    ) : (
                      <TrenchCard
                        key={`${t.chain}:${t.address}`}
                        t={t}
                        accent={s.accent}
                        prefs={prefs}
                        amount={amountFor(t)}
                        nativeSymbol={CHAINS[t.chain].nativeSymbol}
                        selected={sel?.address === t.address}
                        onSelect={() => pick(t)}
                        onBuy={(amt) => quickBuy(t, amt)}
                        buying={buying === t.address}
                      />
                    ),
                  )}
              </div>
            </section>
          ))}
        </div>

        <aside
          aria-label="Coin room"
          className={`${pro ? 'hidden!' : ''} hidden max-h-[calc(100vh-130px)] min-w-0 flex-[1_1_320px] flex-col bg-bar lg:sticky lg:top-16 lg:flex lg:max-w-[360px]`}
        >
          {sel ? (
            <>
              <div className="flex flex-col gap-3.5 border-b border-line p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={sel.symbol} src={sel.imageUrl} size={48} />
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[17px] font-semibold">${sel.symbol}</span>
                    <span className="truncate text-xs text-muted">
                      {sel.name} · {CHAINS[sel.chain].name} · {fmtAge(sel.createdAt)} old
                    </span>
                  </div>
                </div>
                <div className="num grid grid-cols-3 gap-2 text-[11px]">
                  {[
                    ['MC', fmtUsd(sel.marketCapUsd)],
                    ['Vol', fmtUsd(sel.volumeUsd)],
                    ['Bonded', sel.bondingPct != null ? `${sel.bondingPct.toFixed(0)}%` : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex flex-col gap-0.5 rounded-[10px] bg-raised p-2">
                      <span className="text-muted">{k}</span>
                      <span className="text-[13px]">{v}</span>
                    </div>
                  ))}
                </div>
                <SupplySplit intel={sel.intel} risk={sel.risk} compact />
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-lime h-11" onClick={() => quickBuy(sel)} disabled={buying === sel.address}>
                    Quick buy
                  </button>
                  <Link href={`/t/${sel.chain}/${sel.address}`} className="btn-ghost h-11">
                    Open chart
                  </Link>
                </div>
              </div>
              <ChatPanel key={sel.address} roomId={roomIds.coin(sel.chain, sel.address)} title={`$${sel.symbol} room`} placeholder="Talk in the room" className="min-h-0 flex-1" />
            </>
          ) : (
            <p className="p-6 text-sm text-muted">Pick a token to open its room.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

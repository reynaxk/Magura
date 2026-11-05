'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { CHAIN_IDS, CHAINS, fmtAge, fmtUsd, roomIds, type ChainId, type SwapTx, type TrenchStage, type TrenchToken } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { ChatPanel } from '@/components/chat-panel';
import { toast } from '@/components/toaster';
import { Avatar, Icon, RiskTags, Svg } from '@/components/ui';

const STAGES: { id: TrenchStage; title: string; hint: string; accent: string }[] = [
  { id: 'new', title: 'New Pairs', hint: 'just launched', accent: '#8FC6E6' },
  { id: 'almost', title: 'Almost Survived', hint: 'close to bonding', accent: '#FFC66B' },
  { id: 'survived', title: 'Survived', hint: 'migrated to DEX', accent: '#2FE39A' },
];

export default function TrenchesPage() {
  const socket = useSocket();
  const qc = useQueryClient();
  const { me, login, addressFor, sendSwap } = useSession();
  const [chains, setChains] = useState<ChainId[]>(['solana', 'base', 'bsc', 'ethereum']);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<TrenchToken | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [, tick] = useState(0);
  const chainKey = chains.join(',');

  const results = useQueries({
    queries: STAGES.map((s) => ({
      queryKey: ['trenches', s.id, chainKey],
      queryFn: () => api<TrenchToken[]>(`/market/trenches?stage=${s.id}&chains=${chainKey}&limit=40`),
      refetchInterval: paused ? false : 20_000,
    })),
  });

  useEffect(() => {
    socket?.emit('trenches:subscribe', chains);
  }, [socket, chainKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ages tick every second
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useSocketEvent('trenches:token', (t) => {
    if (paused || !chains.includes(t.chain)) return;
    qc.setQueryData<TrenchToken[]>(['trenches', t.stage, chainKey], (xs = []) => [t, ...xs.filter((x) => x.address !== t.address)].slice(0, 60));
  });
  useSocketEvent('trenches:update', (u) => {
    if (paused) return;
    for (const s of STAGES) {
      qc.setQueryData<TrenchToken[]>(['trenches', s.id, chainKey], (xs) => {
        if (!xs) return xs;
        const found = xs.find((x) => x.address === u.address);
        if (!found) return xs;
        const merged = { ...found, ...u } as TrenchToken;
        if (u.stage && u.stage !== s.id) {
          qc.setQueryData<TrenchToken[]>(['trenches', u.stage, chainKey], (ys = []) => [merged, ...ys.filter((y) => y.address !== u.address)]);
          return xs.filter((x) => x.address !== u.address);
        }
        return xs.map((x) => (x.address === u.address ? merged : x));
      });
    }
  });

  async function quickBuy(t: TrenchToken) {
    if (!me) return login();
    const wallet = addressFor(t.chain);
    if (!wallet) return toast({ title: 'No wallet', body: `Connect a ${CHAINS[t.chain].name} wallet` });
    const amount = ((me.settings?.quickBuyAmounts ?? {}) as Record<string, string>)[t.chain] ?? '0.1';
    setBuying(t.address);
    try {
      const q = await api<{ quoteId: string }>('/swap/quote', { body: { chain: t.chain, side: 'buy', token: t.address, amount, slippageBps: 1500, wallet } });
      const tx = await api<SwapTx>('/swap/build', { body: { quoteId: q.quoteId } });
      const txHash = await sendSwap(tx);
      await api('/trades', { body: { quoteId: q.quoteId, chain: t.chain, side: 'buy', tokenAddress: t.address, tokenSymbol: t.symbol, txHash, shareToRoom: true, source: 'quickbuy' } });
      toast({ title: `Bought ${t.symbol}`, body: `${amount} ${CHAINS[t.chain].nativeSymbol} · confirming`, tone: 'lime' });
    } catch (e) {
      toast({ title: 'Quick buy failed', body: (e as Error).message });
    } finally {
      setBuying(null);
    }
  }

  const sel = selected ?? results[1].data?.[0] ?? results[0].data?.[0] ?? null;

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <h1 className="text-[22px] font-semibold tracking-tight">Trenches</h1>
        <button
          onClick={() => setPaused((p) => !p)}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${paused ? 'border-[#4A3A1E] text-amber' : 'border-lime-line bg-lime-dim text-lime'}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-amber' : 'bg-lime'}`} />
          {paused ? 'Paused' : 'Live'}
        </button>
        <div role="group" aria-label="Chains" className="ml-2 flex flex-wrap gap-1.5">
          {CHAIN_IDS.map((c) => {
            const on = chains.includes(c);
            return (
              <button
                key={c}
                onClick={() => setChains((xs) => (on ? (xs.length > 1 ? xs.filter((x) => x !== c) : xs) : [...xs, c]))}
                aria-pressed={on}
                className={on ? 'chip-on' : 'chip'}
              >
                {CHAINS[c].name}
              </button>
            );
          })}
        </div>
        <span className="ml-auto flex items-center gap-2 rounded-xl border border-line-2 bg-raised px-3 py-2 text-xs text-muted">
          <Svg d={Icon.bolt} size={14} color="#2FE39A" /> Quick buy uses your amounts from{' '}
          <Link href="/settings" className="text-lime">
            Settings
          </Link>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-wrap">
        <div className="grid min-w-0 flex-[999_1_820px] grid-cols-[repeat(auto-fit,minmax(300px,1fr))]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          {STAGES.map((s, i) => (
            <section key={s.id} aria-label={s.title} className="flex min-w-0 flex-col border-r border-line">
              <div className="flex items-center gap-2.5 border-b border-line bg-bar px-4 py-3.5">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.accent }} />
                <h2 className="text-[15px] font-semibold">{s.title}</h2>
                <span className="num rounded-md border border-line-2 px-1.5 text-[11px] text-muted">{results[i].data?.length ?? 0}</span>
                <span className="ml-auto text-[11px] text-muted">{s.hint}</span>
              </div>
              <div className="scroll-thin flex max-h-[calc(100vh-190px)] flex-col gap-2 overflow-y-auto p-2.5">
                {results[i].isLoading && Array.from({ length: 5 }).map((_, k) => <div key={k} className="h-[118px] animate-pulse rounded-2xl bg-panel" />)}
                {results[i].data?.length === 0 && <p className="p-6 text-center text-sm text-muted">Nothing here yet — tokens stream in live.</p>}
                {results[i].data?.map((t) => (
                  <TokenCard key={`${t.chain}:${t.address}`} t={t} accent={s.accent} selected={sel?.address === t.address} onSelect={() => setSelected(t)} onBuy={() => quickBuy(t)} buying={buying === t.address} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside aria-label="Coin room" className="flex max-h-[calc(100vh-130px)] min-w-0 flex-[1_1_320px] flex-col bg-bar lg:sticky lg:top-16 lg:max-w-[360px]">
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

function TokenCard({
  t,
  accent,
  selected,
  onSelect,
  onBuy,
  buying,
}: {
  t: TrenchToken;
  accent: string;
  selected: boolean;
  onSelect: () => void;
  onBuy: () => void;
  buying: boolean;
}) {
  const friends = useMemo(() => t.friendsBought.slice(0, 3), [t.friendsBought]);
  return (
    <article
      onClick={onSelect}
      className={`card flex cursor-pointer flex-col gap-2.5 p-3 ${selected ? 'border-lime! bg-[#12161D]' : 'hover:bg-hover'}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar name={t.symbol} src={t.imageUrl} size={52} />
          <span className="num absolute -bottom-1 -right-1 rounded-md border border-line-3 bg-bg px-1 text-[9px] text-text-2">{fmtAge(t.createdAt)}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-sm font-semibold">${t.symbol}</span>
            <span className="truncate text-xs text-muted">{t.name}</span>
          </div>
          <div className="num flex gap-2.5 text-[11px] text-muted">
            <span>
              MC <span className="text-text">{fmtUsd(t.marketCapUsd)}</span>
            </span>
            <span>
              V <span className="text-text">{fmtUsd(t.volumeUsd)}</span>
            </span>
            <span className="uppercase">{t.chain === 'ethereum' ? 'eth' : t.chain}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-md border border-violet-line bg-violet-dim px-1.5 text-[11px] text-violet-2">
              <Svg d={Icon.chat} size={11} color="#B9AEFF" />
              {t.chatCount}
            </span>
            {friends.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="flex">
                  {friends.map((f) => (
                    <span key={f.userId} className="-mr-1.5">
                      <Avatar name={f.handle} src={f.avatarUrl} size={18} shape="circle" ring="#0E1015" />
                    </span>
                  ))}
                </span>
                <span className="ml-1.5 text-[11px] text-text-2">
                  {friends[0].handle}
                  {t.friendsBought.length > 1 ? ` +${t.friendsBought.length - 1}` : ''} aped
                </span>
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBuy();
          }}
          disabled={buying}
          aria-label={`Quick buy ${t.symbol}`}
          className="num flex h-8 shrink-0 items-center gap-1 rounded-[10px] bg-lime px-2.5 text-xs font-semibold text-bg"
        >
          <Svg d={Icon.bolt} size={12} />
          {buying ? '…' : 'Buy'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <RiskTags risk={t.risk} />
        {t.launchpad && <span className="ml-auto text-[10px] text-faint">{t.launchpad}</span>}
      </div>
      {t.stage !== 'survived' && t.bondingPct != null && (
        <div className="flex items-center gap-2">
          <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-line">
            <div className="h-[5px] rounded-full" style={{ width: `${Math.min(100, t.bondingPct)}%`, background: accent }} />
          </div>
          <span className="num text-[10px] text-text-2">{t.bondingPct.toFixed(0)}%</span>
        </div>
      )}
    </article>
  );
}

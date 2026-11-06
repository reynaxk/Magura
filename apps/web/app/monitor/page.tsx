'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtAge, fmtUsd, type SignalDTO, type SignalKind } from '@magura/shared';
import { api } from '@/lib/api';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { useInstantTrade } from '@/lib/trade';
import { usePref } from '@/lib/prefs';
import { soundFor } from '@/lib/sounds';
import { ProSidebar } from '@/components/pro-sidebar';
import { SmartFlow } from '@/components/smart-flow';
import { Avatar, Empty, Icon, Svg } from '@/components/ui';

const KINDS: { id: SignalKind; label: string; color: string }[] = [
  { id: 'smart_buy', label: 'Smart buy', color: '#2FE39A' },
  { id: 'whale_buy', label: 'Whale buy', color: '#4FD1C5' },
  { id: 'dev_sell', label: 'Dev sell', color: '#FF5C7A' },
  { id: 'bundled_launch', label: 'Bundled launch', color: '#F5A64A' },
  { id: 'migrated', label: 'Migrated', color: '#8B9CFF' },
  { id: 'dex_paid', label: 'DEX paid', color: '#5EC8E6' },
];
const meta = (k: SignalKind) => KINDS.find((x) => x.id === k) ?? KINDS[0];

function Buy({ s }: { s: SignalDTO }) {
  const { run, busy, buyAmounts } = useInstantTrade({ chain: s.chain, token: s.address, symbol: s.symbol });
  return (
    <div className="grid grid-cols-3 gap-1">
      {(buyAmounts.length ? buyAmounts : ['0.1', '0.5', '1']).slice(0, 3).map((a) => (
        <button key={a} onClick={() => run('buy', a)} disabled={!!busy} className="num h-7 rounded-md bg-raised text-[11px] font-semibold text-text-2 ring-1 ring-line-2 hover:bg-lime hover:text-bg">
          {busy === 'buy' ? '…' : a}
        </button>
      ))}
    </div>
  );
}

function SignalCard({ s }: { s: SignalDTO }) {
  const m = meta(s.kind);
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-line-2 bg-panel p-3 transition-colors hover:border-line-3" style={{ boxShadow: `inset 3px 0 0 ${m.color}` }}>
      <div className="flex items-center gap-2">
        <Link href={`/t/${s.chain}/${s.address}`} className="flex min-w-0 flex-1 items-center gap-2">
          <Avatar name={s.symbol} src={s.imageUrl} size={30} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold">{s.symbol}</span>
            <span className="num text-[10.5px] text-muted">MC {fmtUsd(s.marketCapUsd)}</span>
          </span>
        </Link>
        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: m.color, background: `${m.color}18` }}>
          {m.label}
        </span>
        <span className="num text-[10px] text-faint">{fmtAge(s.at)}</span>
      </div>
      <p className="text-[12px] text-text-2">{s.detail}</p>
      {s.wallet && (
        <Link href={`/w/${s.chain}/${s.wallet}`} className="num -mt-1 text-[10.5px] text-faint hover:text-lime">
          by {s.wallet.slice(0, 4)}…{s.wallet.slice(-4)}
        </Link>
      )}
      <Buy s={s} />
    </article>
  );
}

/** Monitor: everything worth reacting to, as it happens. */
export default function MonitorPage() {
  const socket = useSocket();
  const qc = useQueryClient();
  const [on, setOn] = usePref<SignalKind[]>('monitor-kinds', KINDS.map((k) => k.id));
  const [sound, setSound] = usePref<boolean>('monitor-sound', false);
  const q = useQuery({ queryKey: ['signals'], queryFn: () => api<SignalDTO[]>('/market/signals'), refetchInterval: 60_000 });
  useEffect(() => {
    socket?.emit('trenches:subscribe', ['solana', 'base', 'bsc', 'ethereum']);
  }, [socket]);
  useSocketEvent('signal', (s) => {
    qc.setQueryData<SignalDTO[]>(['signals'], (xs = []) => [s, ...xs.filter((x) => x.id !== s.id)].slice(0, 300));
    if (sound && on.includes(s.kind) && (s.kind === 'smart_buy' || s.kind === 'whale_buy' || s.kind === 'dev_sell')) soundFor(s.kind === 'dev_sell' ? 'devsell' : 'friend');
  });
  const list = (q.data ?? []).filter((s) => on.includes(s.kind));
  const toggle = (k: SignalKind) => setOn(on.includes(k) ? on.filter((x) => x !== k) : [...on, k]);

  return (
    <div className="flex w-full items-start">
      <ProSidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-[22px] font-semibold tracking-tight">Monitor</h1>
          {KINDS.map((k) => (
            <button
              key={k.id}
              aria-pressed={on.includes(k.id)}
              onClick={() => toggle(k.id)}
              className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold"
              style={{ borderColor: on.includes(k.id) ? `${k.color}66` : '#1F232B', background: on.includes(k.id) ? `${k.color}14` : 'transparent', color: on.includes(k.id) ? '#E9ECF2' : '#7A8397' }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: k.color }} />
              {k.label}
            </button>
          ))}
          <button onClick={() => setSound(!sound)} aria-pressed={sound} className={`ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold ${sound ? 'bg-lime-dim text-lime' : 'bg-raised text-muted'}`}>
            <Svg d={Icon.bell} size={13} />
            Sound {sound ? 'on' : 'off'}
          </button>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <div className="grid min-w-0 flex-[999_1_620px] grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
            {list.map((s) => (
              <SignalCard key={s.id} s={s} />
            ))}
            {!q.isLoading && !list.length && (
              <div className="col-span-full">
                <Empty icon={Icon.trend} title="Waiting for signals">Whale buys, smart-money buys, dev dumps and bundled launches stream in here live.</Empty>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-[1_1_320px] lg:max-w-[380px]">
            <SmartFlow compact />
          </div>
        </div>
      </div>
    </div>
  );
}

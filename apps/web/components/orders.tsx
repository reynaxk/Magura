'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHAINS, fmtUsd, type ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useInstantTrade } from '@/lib/trade';
import { toast } from './toaster';

interface OrderRule {
  id: string;
  kind: 'tp' | 'sl' | 'trail' | 'limit_buy';
  triggerPct: number | null;
  triggerMcUsd: number | null;
  sellPct: number | null;
  buyAmount: string | null;
  status: string;
}

const NAME: Record<OrderRule['kind'], string> = { tp: 'Take profit', sl: 'Stop loss', trail: 'Trailing stop', limit_buy: 'Limit buy' };

function describe(o: OrderRule, native: string) {
  if (o.kind === 'limit_buy') return `Buy ${o.buyAmount} ${native} at MC ≤ ${fmtUsd(o.triggerMcUsd)}`;
  if (o.kind === 'trail') return `Sell ${o.sellPct}% if it drops ${o.triggerPct}% from the top`;
  return `Sell ${o.sellPct}% at ${o.kind === 'tp' ? '+' : ''}${o.triggerPct}%`;
}

export function useOrders(chain: ChainId, token: string) {
  const { me } = useSession();
  return useQuery({
    queryKey: ['orders', chain, token],
    queryFn: () => api<OrderRule[]>(`/orders?chain=${chain}&token=${token}`),
    enabled: !!me,
    refetchInterval: 15_000,
  });
}

function useCreateOrders(chain: ChainId, token: string, symbol: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orders: Record<string, unknown>[]) =>
      api('/orders', { body: { orders: orders.map((o) => ({ chain, tokenAddress: token, tokenSymbol: symbol, ...o })) } }),
    onSuccess: () => {
      toast({ title: 'Orders set', body: 'Magura watches the price for you, 24/7', tone: 'lime' });
      qc.invalidateQueries({ queryKey: ['orders', chain, token] });
    },
    onError: (e) => toast({ title: 'Could not set orders', body: (e as Error).message.replace(/_/g, ' ') }),
  });
}

const num = (v: string) => v.replace(/[^\d.]/g, '');

/** Take profit (up to two steps), stop loss and trailing stop on your position. */
export function TpSlForm({ chain, token, symbol }: { chain: ChainId; token: string; symbol: string }) {
  const { me, login } = useSession();
  const [tp1, setTp1] = useState({ on: true, pct: '100', sell: '50' });
  const [tp2, setTp2] = useState({ on: true, pct: '400', sell: '100' });
  const [sl, setSl] = useState({ on: true, pct: '35', sell: '100' });
  const [trail, setTrail] = useState({ on: false, pct: '25', sell: '100' });
  const create = useCreateOrders(chain, token, symbol);

  const rows: { label: string; v: typeof tp1; set: (v: typeof tp1) => void; sign: string; hint: string }[] = [
    { label: 'TP 1', v: tp1, set: setTp1, sign: '+', hint: 'gain' },
    { label: 'TP 2', v: tp2, set: setTp2, sign: '+', hint: 'gain' },
    { label: 'Stop loss', v: sl, set: setSl, sign: '−', hint: 'loss' },
    { label: 'Trailing', v: trail, set: setTrail, sign: '−', hint: 'from top' },
  ];
  const submit = () => {
    if (!me) return login();
    const orders: Record<string, unknown>[] = [];
    if (tp1.on) orders.push({ kind: 'tp', triggerPct: Number(tp1.pct), sellPct: Number(tp1.sell) });
    if (tp2.on) orders.push({ kind: 'tp', triggerPct: Number(tp2.pct), sellPct: Number(tp2.sell) });
    if (sl.on) orders.push({ kind: 'sl', triggerPct: Number(sl.pct), sellPct: Number(sl.sell) });
    if (trail.on) orders.push({ kind: 'trail', triggerPct: Number(trail.pct), sellPct: Number(trail.sell) });
    if (!orders.length) return toast({ title: 'Nothing to set', body: 'Turn on at least one order' });
    create.mutate(orders);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-muted">Set exits for your {symbol} position. Percentages count from today&apos;s price.</p>
      <div className="flex flex-col gap-1.5 rounded-xl bg-raised p-2.5">
        {rows.map((r) => (
          <div key={r.label} className={`grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs ${r.v.on ? '' : 'opacity-50'}`}>
            <label className="flex items-center gap-2 text-text-2">
              <input type="checkbox" checked={r.v.on} onChange={(e) => r.set({ ...r.v, on: e.target.checked })} className="h-4 w-4 accent-lime" />
              {r.label}
            </label>
            <label className="num flex items-center gap-1 text-faint">
              {r.sign}
              <input aria-label={`${r.label} percent ${r.hint}`} className="input num h-8 w-14 px-1.5 text-center text-xs" inputMode="decimal" value={r.v.pct} onChange={(e) => r.set({ ...r.v, pct: num(e.target.value) })} />%
            </label>
            <label className="num flex items-center gap-1 text-faint">
              sell
              <input aria-label={`${r.label} sell percent`} className="input num h-8 w-12 px-1.5 text-center text-xs" inputMode="numeric" value={r.v.sell} onChange={(e) => r.set({ ...r.v, sell: num(e.target.value) })} />%
            </label>
          </div>
        ))}
      </div>
      <button onClick={submit} disabled={create.isPending} className="btn h-11 rounded-[12px] bg-lime text-[14px] text-bg">
        {create.isPending ? 'Setting…' : 'Set exits'}
      </button>
    </div>
  );
}

/** Buy automatically when the market cap falls to a target. */
export function LimitBuyForm({ chain, token, symbol, mcUsd }: { chain: ChainId; token: string; symbol: string; mcUsd: number | null }) {
  const { me, login } = useSession();
  const native = CHAINS[chain].nativeSymbol;
  const [amount, setAmount] = useState('0.5');
  const [mc, setMc] = useState(mcUsd ? String(Math.round(mcUsd * 0.75)) : '');
  const create = useCreateOrders(chain, token, symbol);
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Buy when market cap drops to
        <input className="input num h-11 text-[15px]" inputMode="numeric" placeholder="45000" value={mc} onChange={(e) => setMc(e.target.value.replace(/\D/g, ''))} />
        {mcUsd != null && <span className="num text-[11px] text-faint">Now {fmtUsd(mcUsd)}</span>}
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Amount ({native})
        <input className="input num h-11 text-[15px]" inputMode="decimal" value={amount} onChange={(e) => setAmount(num(e.target.value))} />
      </label>
      <button
        onClick={() => (me ? create.mutate([{ kind: 'limit_buy', triggerMcUsd: Number(mc), buyAmount: amount }]) : login())}
        disabled={create.isPending || !mc || !amount}
        className="btn h-11 rounded-[12px] bg-lime text-[14px] text-bg"
      >
        {create.isPending ? 'Setting…' : `Place limit buy`}
      </button>
    </div>
  );
}

/** Active orders for this coin, plus a banner for any that fired and need your signature. */
export function ActiveOrders({ chain, token, symbol }: { chain: ChainId; token: string; symbol: string }) {
  const qc = useQueryClient();
  const orders = useOrders(chain, token);
  const native = CHAINS[chain].nativeSymbol;
  const { run, busy } = useInstantTrade({ chain, token, symbol });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', chain, token] }),
  });
  const list = orders.data ?? [];
  if (!list.length) return null;

  const confirm = async (o: OrderRule) => {
    await run(o.kind === 'limit_buy' ? 'buy' : 'sell', o.kind === 'limit_buy' ? o.buyAmount! : o.sellPct ?? 100, { source: 'manual' });
    await api(`/orders/${o.id}/done`, { body: { txHash: null } });
    qc.invalidateQueries({ queryKey: ['orders', chain, token] });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {list
        .filter((o) => o.status === 'awaiting_confirm')
        .map((o) => (
          <div key={o.id} className="flex flex-col gap-2 rounded-xl border border-lime-line bg-lime-dim p-3 text-xs">
            <span className="font-semibold text-lime">{NAME[o.kind]} hit</span>
            <span className="text-text-2">{describe(o, native)}</span>
            <div className="flex gap-1.5">
              <button className="btn-ghost h-8 flex-1 text-xs" onClick={() => api(`/orders/${o.id}/done`, { body: { skipped: true } }).then(() => qc.invalidateQueries({ queryKey: ['orders', chain, token] }))}>
                Skip
              </button>
              <button className="btn-lime h-8 flex-1 text-xs" disabled={!!busy} onClick={() => confirm(o)}>
                Confirm
              </button>
            </div>
          </div>
        ))}
      <span className="label mt-1">Active orders</span>
      {list
        .filter((o) => o.status !== 'awaiting_confirm')
        .map((o) => (
          <div key={o.id} className="flex items-center gap-2 rounded-lg border border-line-2 px-2.5 py-2 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full ${o.kind === 'sl' ? 'bg-down' : 'bg-lime'}`} />
            <span className="flex flex-col">
              <span className="font-semibold">{NAME[o.kind]}</span>
              <span className="num text-[11px] text-muted">{describe(o, native)}</span>
            </span>
            <button aria-label={`Cancel ${NAME[o.kind]}`} onClick={() => cancel.mutate(o.id)} className="ml-auto text-[11px] text-faint hover:text-down-2">
              Cancel
            </button>
          </div>
        ))}
    </div>
  );
}

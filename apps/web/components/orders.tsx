'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHAINS, fmtUsd, type ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useInstantTrade } from '@/lib/trade';
import { toast } from './toaster';

type Kind = 'tp' | 'sl' | 'trail' | 'trail_tp' | 'limit_buy' | 'dca' | 'dev_sell' | 'dev_sell_buy' | 'migrate_buy' | 'migrate_sell' | 'dev_snipe';
interface OrderRule {
  id: string;
  kind: Kind;
  triggerPct: number | null;
  triggerMcUsd: number | null;
  sellPct: number | null;
  buyAmount: string | null;
  status: string;
  armPct: number | null;
  armed: boolean;
  intervalSec: number | null;
  slicesTotal: number | null;
  slicesDone: number;
  minMcUsd: number | null;
}

const NAME: Record<Kind, string> = {
  tp: 'Take profit',
  sl: 'Stop loss',
  trail: 'Trailing stop',
  trail_tp: 'Trailing take profit',
  limit_buy: 'Limit buy',
  dca: 'DCA',
  dev_sell: 'Sell on dev sell',
  dev_sell_buy: 'Buy on dev sell',
  migrate_buy: 'Buy on migration',
  migrate_sell: 'Sell on migration',
  dev_snipe: 'Dev snipe',
};
const BUY_KINDS: Kind[] = ['limit_buy', 'dca', 'dev_sell_buy', 'migrate_buy', 'dev_snipe'];
const every = (s: number) => (s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(s % 3600 ? 1 : 0)}h`);

function describe(o: OrderRule, native: string) {
  switch (o.kind) {
    case 'limit_buy':
      return `Buy ${o.buyAmount} ${native} at MC ≤ ${fmtUsd(o.triggerMcUsd)}`;
    case 'trail':
      return `Sell ${o.sellPct}% if it drops ${o.triggerPct}% from the top`;
    case 'trail_tp':
      return `${o.armed ? 'Armed · ' : `Arms at +${o.armPct}% · `}sell ${o.sellPct}% on a ${o.triggerPct}% pullback`;
    case 'dca': {
      const band = o.minMcUsd || o.triggerMcUsd ? ` · MC ${o.minMcUsd ? fmtUsd(o.minMcUsd) : '0'}–${o.triggerMcUsd ? fmtUsd(o.triggerMcUsd) : '∞'}` : '';
      return `${o.buyAmount} ${native} every ${every(o.intervalSec ?? 60)} · ${o.slicesDone}/${o.slicesTotal} bought${band}`;
    }
    case 'dev_sell':
      return `Sell ${o.sellPct}% the moment the dev sells`;
    case 'dev_sell_buy':
      return `Buy ${o.buyAmount} ${native} when the dev sells`;
    case 'migrate_buy':
      return `Buy ${o.buyAmount} ${native} when it migrates to a DEX`;
    case 'migrate_sell':
      return `Sell ${o.sellPct}% when it migrates`;
    case 'dev_snipe':
      return `Buy ${o.buyAmount} ${native} of this dev's next launch`;
    default:
      return `Sell ${o.sellPct}% at ${o.kind === 'tp' ? '+' : ''}${o.triggerPct}%`;
  }
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
  const [ttp, setTtp] = useState({ on: false, arm: '100', pct: '20', sell: '100' });
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
    if (ttp.on) orders.push({ kind: 'trail_tp', armPct: Number(ttp.arm), triggerPct: Number(ttp.pct), sellPct: Number(ttp.sell) });
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
        <div className={`flex flex-col gap-1.5 border-t border-line pt-2 text-xs ${ttp.on ? '' : 'opacity-50'}`}>
          <label className="flex items-center gap-2 text-text-2">
            <input type="checkbox" checked={ttp.on} onChange={(e) => setTtp({ ...ttp, on: e.target.checked })} className="h-4 w-4 accent-lime" />
            Trailing take profit
          </label>
          <div className="num flex flex-wrap items-center gap-1.5 pl-6 text-faint">
            arm at +
            <input aria-label="Arm at percent gain" className="input num h-8 w-14 px-1.5 text-center text-xs" inputMode="decimal" value={ttp.arm} onChange={(e) => setTtp({ ...ttp, arm: num(e.target.value) })} />% · sell
            <input aria-label="Trailing take profit sell percent" className="input num h-8 w-12 px-1.5 text-center text-xs" inputMode="numeric" value={ttp.sell} onChange={(e) => setTtp({ ...ttp, sell: num(e.target.value) })} />% on a
            <input aria-label="Pullback percent" className="input num h-8 w-12 px-1.5 text-center text-xs" inputMode="decimal" value={ttp.pct} onChange={(e) => setTtp({ ...ttp, pct: num(e.target.value) })} />% pullback
          </div>
        </div>
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

const INTERVALS = [
  { s: 60, l: '1m' },
  { s: 300, l: '5m' },
  { s: 900, l: '15m' },
  { s: 3600, l: '1h' },
  { s: 14_400, l: '4h' },
  { s: 86_400, l: '1d' },
];

/** Dollar-cost average: buy a fixed amount on a timer, optionally only inside a market-cap band. */
export function DcaForm({ chain, token, symbol, mcUsd }: { chain: ChainId; token: string; symbol: string; mcUsd: number | null }) {
  const { me, login } = useSession();
  const native = CHAINS[chain].nativeSymbol;
  const [amount, setAmount] = useState('0.1');
  const [slices, setSlices] = useState('5');
  const [interval, setIntervalSec] = useState(900);
  const [minMc, setMinMc] = useState('');
  const [maxMc, setMaxMc] = useState('');
  const create = useCreateOrders(chain, token, symbol);
  const total = Number(amount || 0) * Number(slices || 0);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-muted">Spread your buy over time instead of aping at one price.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Each buy ({native})
          <input className="input num h-11 text-[15px]" inputMode="decimal" value={amount} onChange={(e) => setAmount(num(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Number of buys
          <input className="input num h-11 text-[15px]" inputMode="numeric" value={slices} onChange={(e) => setSlices(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </label>
      </div>
      <div className="flex flex-col gap-1.5 text-xs text-muted">
        Every
        <div className="grid grid-cols-6 gap-1">
          {INTERVALS.map((i) => (
            <button key={i.s} onClick={() => setIntervalSec(i.s)} className={`num h-9 rounded-lg text-xs font-semibold ${interval === i.s ? 'bg-text text-bg' : 'bg-raised text-text-2 hover:text-text'}`}>
              {i.l}
            </button>
          ))}
        </div>
      </div>
      <details className="rounded-xl bg-raised px-3 py-2 text-xs text-muted">
        <summary className="cursor-pointer select-none font-semibold text-text-2">Market cap band (optional)</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input className="input num h-10 text-sm" inputMode="numeric" placeholder="Min MC" value={minMc} onChange={(e) => setMinMc(e.target.value.replace(/\D/g, ''))} aria-label="Minimum market cap" />
          <input className="input num h-10 text-sm" inputMode="numeric" placeholder="Max MC" value={maxMc} onChange={(e) => setMaxMc(e.target.value.replace(/\D/g, ''))} aria-label="Maximum market cap" />
        </div>
        <p className="mt-1.5 text-[11px] text-faint">Buys are skipped while the market cap is outside the band{mcUsd != null ? ` · now ${fmtUsd(mcUsd)}` : ''}.</p>
      </details>
      <p className="num text-[11px] text-faint">
        Total {total ? total.toFixed(3).replace(/\.?0+$/, '') : 0} {native} over {every(interval * Math.max(0, Number(slices || 0) - 1)) || 'now'}
      </p>
      <button
        onClick={() =>
          me
            ? create.mutate([
                {
                  kind: 'dca',
                  buyAmount: amount,
                  slices: Number(slices),
                  intervalSec: interval,
                  ...(minMc ? { minMcUsd: Number(minMc) } : {}),
                  ...(maxMc ? { triggerMcUsd: Number(maxMc) } : {}),
                },
              ])
            : login()
        }
        disabled={create.isPending || !amount || Number(slices) < 2}
        className="btn h-11 rounded-[12px] bg-lime text-[14px] text-bg"
      >
        {create.isPending ? 'Setting…' : 'Start DCA'}
      </button>
    </div>
  );
}

/** One-switch automations that react to what the dev and the coin do. */
export function AutoTriggersForm({ chain, token, symbol }: { chain: ChainId; token: string; symbol: string }) {
  const { me, login } = useSession();
  const native = CHAINS[chain].nativeSymbol;
  const orders = useOrders(chain, token);
  const create = useCreateOrders(chain, token, symbol);
  const [buy, setBuy] = useState('0.1');
  const [sell, setSell] = useState('100');
  const active = new Set((orders.data ?? []).map((o) => o.kind));
  const rows: { kind: Kind; title: string; hint: string; payload: () => Record<string, unknown> }[] = [
    { kind: 'dev_sell', title: 'Sell when the dev sells', hint: 'Exit the second the creator dumps', payload: () => ({ sellPct: Number(sell) }) },
    { kind: 'dev_sell_buy', title: 'Buy when the dev sells', hint: 'Buy the panic after the dev is out', payload: () => ({ buyAmount: buy }) },
    { kind: 'migrate_buy', title: 'Buy on migration', hint: 'Buy the moment it leaves the bonding curve', payload: () => ({ buyAmount: buy }) },
    { kind: 'migrate_sell', title: 'Sell on migration', hint: 'Take profit when it hits the DEX', payload: () => ({ sellPct: Number(sell) }) },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Buy amount ({native})
          <input className="input num h-10 text-sm" inputMode="decimal" value={buy} onChange={(e) => setBuy(num(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Sell % of position
          <input className="input num h-10 text-sm" inputMode="numeric" value={sell} onChange={(e) => setSell(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </label>
      </div>
      <div className="flex flex-col divide-y divide-line rounded-xl bg-raised">
        {rows.map((r) => {
          const on = active.has(r.kind);
          return (
            <div key={r.kind} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-semibold">{r.title}</span>
                <span className="text-[11px] text-muted">{r.hint}</span>
              </span>
              <button
                disabled={on || create.isPending}
                onClick={() => (me ? create.mutate([{ kind: r.kind, ...r.payload() }]) : login())}
                className={`h-8 shrink-0 rounded-lg px-3 text-xs font-semibold ${on ? 'bg-lime-dim text-lime' : 'bg-text text-bg hover:brightness-95'}`}
              >
                {on ? 'On' : 'Set'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-faint">Dev-sell automations work on coins Magura saw launch. Cancel any of them under Active orders.</p>
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
    const buy = BUY_KINDS.includes(o.kind);
    await run(buy ? 'buy' : 'sell', buy ? o.buyAmount! : (o.sellPct ?? 100), { source: 'manual' });
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
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.kind === 'sl' || o.kind === 'dev_sell' ? 'bg-down' : BUY_KINDS.includes(o.kind) ? 'bg-sky' : 'bg-lime'}`} />
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

/** Dev snipe: buy the next coin this wallet creates, the second it launches. */
export function DevSnipe({ chain, creator }: { chain: ChainId; creator: string }) {
  const { me, login } = useSession();
  const qc = useQueryClient();
  const native = CHAINS[chain].nativeSymbol;
  const [amount, setAmount] = useState('0.2');
  const active = useQuery({
    queryKey: ['orders', chain, creator],
    queryFn: () => api<OrderRule[]>(`/orders?chain=${chain}&token=${creator}`),
    enabled: !!me,
  });
  const armed = (active.data ?? []).find((o) => o.kind === 'dev_snipe');
  const create = useMutation({
    mutationFn: () => api('/orders', { body: { orders: [{ chain, tokenAddress: creator, tokenSymbol: 'DEV', kind: 'dev_snipe', buyAmount: amount, slippageBps: 3000 }] } }),
    onSuccess: () => {
      toast({ title: 'Dev snipe armed', body: `Magura buys ${amount} ${native} of this dev's next coin the moment it launches`, tone: 'lime' });
      qc.invalidateQueries({ queryKey: ['orders', chain, creator] });
    },
    onError: (e) => toast({ title: 'Could not arm snipe', body: (e as Error).message.replace(/_/g, ' ') }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', chain, creator] }),
  });
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line-2 bg-raised p-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">Snipe this dev&apos;s next coin</span>
        {armed && <span className="rounded bg-lime-dim px-1.5 text-[10px] font-bold text-lime">ARMED</span>}
      </div>
      {armed ? (
        <div className="flex items-center gap-2 text-[12px] text-text-2">
          Buying {armed.buyAmount} {native} on their next launch
          <button onClick={() => cancel.mutate(armed.id)} className="ml-auto text-[11px] text-faint hover:text-down-2">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <label className="flex h-9 flex-1 items-center gap-1 rounded-lg border border-line-2 bg-bg px-2.5">
            <input aria-label="Snipe amount" className="num w-full bg-transparent text-sm outline-none" inputMode="decimal" value={amount} onChange={(e) => setAmount(num(e.target.value))} />
            <span className="text-[11px] text-faint">{native}</span>
          </label>
          <button onClick={() => (me ? create.mutate() : login())} disabled={create.isPending || !amount} className="btn-lime h-9 px-3 text-xs">
            Arm snipe
          </button>
        </div>
      )}
      <span className="text-[10.5px] text-faint">Fires once, from your delegated wallet (or asks you to confirm). Works for launches on Pump.fun.</span>
    </div>
  );
}

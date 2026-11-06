'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from './toaster';
import { Empty, Icon, Segmented } from './ui';

interface WalletCopy {
  id: string;
  wallet: string;
  label: string;
  buyMode: 'fixed' | 'ratio';
  buyAmount: string;
  ratioPct: number | null;
  sellMode: 'copy' | 'none';
  minMcUsd: number | null;
  maxMcUsd: number | null;
  maxAgeMin: number | null;
  buyOnce: boolean;
  skipAddOn: boolean;
  tpPct: number | null;
  slPct: number | null;
  status: 'active' | 'paused';
  buys: number;
  sells: number;
  skipped: number;
}

const num = (v: string) => v.replace(/[^0-9.]/g, '').slice(0, 12);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted">
      <span>
        {label}
        {hint && <span className="text-faint"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Check({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-text-2">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-[var(--color-lime)]" />
      {label}
    </label>
  );
}

/** Copy any wallet — GMGN-style form + your active copies. */
export function WalletCopyPanel({ initialWallet = '' }: { initialWallet?: string }) {
  const { me, login } = useSession();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['wallet-copies'], queryFn: () => api<WalletCopy[]>('/copy/wallets'), enabled: !!me, refetchInterval: 20_000 });
  const [f, setF] = useState({
    wallet: initialWallet,
    label: '',
    buyMode: 'fixed' as 'fixed' | 'ratio',
    buyAmount: '0.1',
    ratioPct: '10',
    sellMode: 'copy' as 'copy' | 'none',
    minMc: '',
    maxMc: '',
    maxAge: '',
    buyOnce: true,
    skipAddOn: true,
    tp: '',
    sl: '',
    blacklist: '',
    slippage: '25',
  });
  useEffect(() => {
    if (initialWallet) setF((x) => ({ ...x, wallet: initialWallet }));
  }, [initialWallet]);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const create = useMutation({
    mutationFn: () =>
      api<{ error?: string }>('/copy/wallets', {
        body: {
          wallet: f.wallet.trim(),
          label: f.label.trim() || short(f.wallet.trim()),
          buyMode: f.buyMode,
          buyAmount: f.buyAmount,
          ...(f.buyMode === 'ratio' ? { ratioPct: Number(f.ratioPct) } : {}),
          sellMode: f.sellMode,
          ...(f.minMc ? { minMcUsd: Number(f.minMc) } : {}),
          ...(f.maxMc ? { maxMcUsd: Number(f.maxMc) } : {}),
          ...(f.maxAge ? { maxAgeMin: Number(f.maxAge) } : {}),
          buyOnce: f.buyOnce,
          skipAddOn: f.skipAddOn,
          ...(f.tp ? { tpPct: Number(f.tp) } : {}),
          ...(f.sl ? { slPct: Number(f.sl) } : {}),
          blacklist: f.blacklist.split(/[\s,]+/).filter((x) => x.length > 30),
          slippageBps: Math.round(Number(f.slippage || 25) * 100),
        },
      }),
    onSuccess: (r) => {
      if (r?.error) return toast({ title: "Couldn't start copy", body: r.error.replace(/_/g, ' ') });
      toast({ title: 'Copying wallet', body: 'Its next pump.fun trades mirror into your wallet', tone: 'lime' });
      qc.invalidateQueries({ queryKey: ['wallet-copies'] });
    },
    onError: (e) => toast({ title: "Couldn't start copy", body: (e as Error).message.replace(/_/g, ' ') }),
  });
  const toggle = useMutation({
    mutationFn: (c: WalletCopy) => api(`/copy/wallets/${c.id}`, { method: 'PATCH', body: { status: c.status === 'active' ? 'paused' : 'active' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallet-copies'] }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/copy/wallets/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['wallet-copies'] }) });
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(f.wallet.trim()) && Number(f.buyAmount) > 0;

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section className="panel flex min-w-0 flex-[1_1_420px] flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-semibold">Copy any wallet</h2>
          <p className="text-[13px] text-muted">Paste a Solana wallet — a whale, a KOL, a smart trader from the Smart page. Its pump.fun buys and sells mirror into your wallet within seconds.</p>
        </div>
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <Field label="Wallet">
            <input className="input num h-11 text-[13px]" placeholder="Wallet address" value={f.wallet} onChange={(e) => set({ wallet: e.target.value })} />
          </Field>
          <Field label="Name">
            <input className="input h-11 text-[13px]" placeholder="e.g. whale #1" maxLength={24} value={f.label} onChange={(e) => set({ label: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="label">Buy size</span>
          <Segmented
            label="Buy mode"
            value={f.buyMode}
            onChange={(buyMode) => set({ buyMode })}
            options={[
              { value: 'fixed', label: 'Fixed amount' },
              { value: 'ratio', label: '% of their size' },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field label={f.buyMode === 'fixed' ? 'Each buy (SOL)' : 'Max per buy (SOL)'}>
              <input className="input num h-11" inputMode="decimal" value={f.buyAmount} onChange={(e) => set({ buyAmount: num(e.target.value) })} />
            </Field>
            {f.buyMode === 'ratio' && (
              <Field label="Their size ×" hint="%">
                <input className="input num h-11" inputMode="numeric" value={f.ratioPct} onChange={(e) => set({ ratioPct: num(e.target.value) })} />
              </Field>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="label">Sells</span>
          <Segmented
            label="Sell mode"
            value={f.sellMode}
            onChange={(sellMode) => set({ sellMode })}
            options={[
              { value: 'copy', label: 'Copy their sells' },
              { value: 'none', label: "Don't sell — use TP / SL" },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Take profit" hint="% gain">
              <input className="input num h-10" inputMode="decimal" placeholder="e.g. 100" value={f.tp} onChange={(e) => set({ tp: num(e.target.value) })} />
            </Field>
            <Field label="Stop loss" hint="% drop">
              <input className="input num h-10" inputMode="decimal" placeholder="e.g. 30" value={f.sl} onChange={(e) => set({ sl: num(e.target.value) })} />
            </Field>
          </div>
        </div>
        <details className="rounded-xl border border-line-2 bg-raised px-4 py-3" open>
          <summary className="cursor-pointer select-none text-[13px] font-semibold">Filters</summary>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Min MC ($)">
              <input className="input num h-10" inputMode="numeric" value={f.minMc} onChange={(e) => set({ minMc: num(e.target.value) })} />
            </Field>
            <Field label="Max MC ($)">
              <input className="input num h-10" inputMode="numeric" value={f.maxMc} onChange={(e) => set({ maxMc: num(e.target.value) })} />
            </Field>
            <Field label="Max coin age" hint="min">
              <input className="input num h-10" inputMode="numeric" value={f.maxAge} onChange={(e) => set({ maxAge: num(e.target.value) })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <Check on={f.buyOnce} set={(buyOnce) => set({ buyOnce })} label="Buy each coin only once" />
            <Check on={f.skipAddOn} set={(skipAddOn) => set({ skipAddOn })} label="Skip their add-on buys" />
          </div>
          <div className="mt-3 grid grid-cols-[2fr_1fr] gap-2">
            <Field label="Blacklist" hint="coin addresses to never copy">
              <input className="input num h-10 text-[12px]" value={f.blacklist} onChange={(e) => set({ blacklist: e.target.value })} />
            </Field>
            <Field label="Slippage" hint="%">
              <input className="input num h-10" inputMode="decimal" value={f.slippage} onChange={(e) => set({ slippage: num(e.target.value) })} />
            </Field>
          </div>
        </details>
        <button disabled={!valid || create.isPending} onClick={() => (me ? create.mutate() : login())} className="btn h-12 rounded-[14px] bg-lime text-[15px] text-bg disabled:opacity-40">
          {create.isPending ? 'Starting…' : 'Start copying'}
        </button>
        <p className="text-[11px] text-faint">Runs from your delegated wallet (Settings → Trading), otherwise each trade asks you to confirm. Pump.fun coins only for now.</p>
      </section>

      <section className="panel flex min-w-0 flex-[1_1_380px] flex-col overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Your wallet copies</h2>
        {!me && <p className="p-5 text-[13px] text-muted">Log in to copy wallets.</p>}
        {me && list.data?.length === 0 && <Empty icon={Icon.trend} title="Not copying anyone yet">Find a wallet on the Smart page and paste it here.</Empty>}
        {list.data?.map((c) => (
          <div key={c.id} className="flex flex-col gap-1.5 border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${c.status === 'active' ? 'bg-lime' : 'bg-faint'}`} />
              <Link href={`/w/solana/${c.wallet}`} className="text-[14px] font-semibold hover:text-lime">
                {c.label}
              </Link>
              <span className="num text-[11px] text-faint">{short(c.wallet)}</span>
              <span className="ml-auto flex gap-1.5">
                <button onClick={() => toggle.mutate(c)} className="h-7 rounded-lg bg-raised px-2.5 text-[11px] font-semibold text-text-2 hover:text-text">
                  {c.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                <button onClick={() => remove.mutate(c.id)} className="h-7 rounded-lg px-2 text-[11px] text-faint hover:text-down-2">
                  Delete
                </button>
              </span>
            </div>
            <span className="num text-[11.5px] text-muted">
              {c.buyMode === 'fixed' ? `${c.buyAmount} SOL each` : `${c.ratioPct}% of their size, max ${c.buyAmount} SOL`}
              {c.sellMode === 'copy' ? ' · copies sells' : ' · holds'}
              {c.tpPct ? ` · TP +${c.tpPct}%` : ''}
              {c.slPct ? ` · SL −${c.slPct}%` : ''}
              {c.maxMcUsd ? ` · MC ≤ $${c.maxMcUsd.toLocaleString()}` : ''}
            </span>
            <span className="num text-[11px] text-faint">
              <span className="text-lime">{c.buys}</span> buys · <span className="text-down-2">{c.sells}</span> sells · {c.skipped} skipped
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

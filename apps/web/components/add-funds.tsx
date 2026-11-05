'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from './toaster';

type Chain = 'solana' | 'base' | 'ethereum';
const LABEL: Record<Chain, string> = { solana: 'SOL on Solana', base: 'ETH on Base', ethereum: 'ETH on Ethereum' };

/** "Add funds" — buy SOL/ETH by card or Apple Pay through Coinbase, sent straight to your own wallet. Hidden until the onramp is switched on. */
export function AddFunds({ variant = 'button', defaultChain = 'solana' }: { variant?: 'button' | 'link'; defaultChain?: Chain }) {
  const { me, login } = useSession();
  const status = useQuery({ queryKey: ['onramp-status'], queryFn: () => api<{ available: boolean }>('/onramp/status'), staleTime: 600_000 });
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState<Chain>(defaultChain);
  const [amount, setAmount] = useState('50');
  const [busy, setBusy] = useState(false);
  if (!status.data?.available) return null;

  const go = async () => {
    if (!me) return login();
    setBusy(true);
    // open the tab first so the popup isn't blocked, then point it at Coinbase
    const tab = window.open('about:blank', '_blank');
    try {
      const r = await api<{ url: string }>('/onramp/session', { body: { chain, amountUsd: Number(amount) || 50 } });
      if (tab) tab.location.href = r.url;
      else window.location.href = r.url;
      setOpen(false);
    } catch (e) {
      tab?.close();
      toast({ title: 'Could not start the purchase', body: (e as Error).message.replace(/_/g, ' ') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => (me ? setOpen(true) : login())} className={variant === 'link' ? 'text-[11px] text-lime hover:underline' : 'btn-lime h-10 px-4 text-sm'}>
        Add funds
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Add funds" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 md:items-center md:p-4" onClick={() => setOpen(false)}>
          <div className="panel flex w-full max-w-md flex-col gap-4 rounded-b-none p-5 md:rounded-b-[20px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1">
              <h2 className="text-[17px] font-semibold">Add funds</h2>
              <p className="text-xs text-muted">Pay by card or Apple Pay through Coinbase. The coins go straight to your own wallet.</p>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(LABEL) as Chain[]).map((c) => (
                <button key={c} onClick={() => setChain(c)} className={`h-12 rounded-xl border px-2 text-xs font-semibold ${chain === c ? 'border-lime-line bg-lime-dim text-lime' : 'border-line-2 text-text-2'}`}>
                  {LABEL[c]}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Amount (USD)
              <input className="input num h-12 text-[15px]" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
            </label>
            <div className="flex gap-1.5">
              {['25', '50', '100', '250'].map((v) => (
                <button key={v} onClick={() => setAmount(v)} className={amount === v ? 'chip-on' : 'chip'}>
                  ${v}
                </button>
              ))}
            </div>
            <button className="btn-lime h-12" disabled={busy || Number(amount) < 5} onClick={go}>
              {busy ? 'Opening Coinbase…' : `Continue to pay $${amount || 0}`}
            </button>
            <p className="text-[11px] text-faint">Coinbase handles payment and any ID checks. Availability and limits depend on your country.</p>
          </div>
        </div>
      )}
    </>
  );
}

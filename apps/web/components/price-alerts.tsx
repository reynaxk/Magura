'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtPrice, fmtUsd, type ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from './toaster';
import { Icon, Svg } from './ui';

interface Alert {
  id: string;
  metric: 'price' | 'mc';
  direction: 'above' | 'below';
  value: number;
}

/** "Alert me" on the coin page: price or market cap, above or below. */
export function PriceAlertButton({ chain, token, symbol, priceUsd, mcUsd }: { chain: ChainId; token: string; symbol: string; priceUsd: number | null; mcUsd: number | null }) {
  const { me, login } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<'mc' | 'price'>('mc');
  const [value, setValue] = useState('');
  const key = ['alerts', chain, token];
  const alerts = useQuery({ queryKey: key, queryFn: () => api<Alert[]>(`/alerts?chain=${chain}&token=${token}`), enabled: !!me });
  const create = useMutation({
    mutationFn: () => api('/alerts', { body: { chain, tokenAddress: token, tokenSymbol: symbol, metric, value: Number(value) } }),
    onSuccess: () => {
      toast({ title: 'Alert set', body: 'We will ping you here, by push and on Telegram', tone: 'lime' });
      setValue('');
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast({ title: 'Could not set alert', body: (e as Error).message.replace(/_/g, ' ') }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/alerts/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const now = metric === 'mc' ? mcUsd : priceUsd;
  const quick = metric === 'mc' && mcUsd ? [0.5, 2, 5].map((x) => Math.round(mcUsd * x)) : priceUsd ? [0.8, 1.5, 2].map((x) => priceUsd * x) : [];
  const count = alerts.data?.length ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => (me ? setOpen((v) => !v) : login())}
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-line-2 px-2.5 text-xs text-text-2 hover:bg-hover"
      >
        <Svg d={Icon.bell} size={13} />
        Alert{count ? ` · ${count}` : ''}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 flex w-[300px] flex-col gap-3 rounded-2xl border border-line-3 bg-raised p-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">Alert me when</span>
            <span className="ml-auto flex gap-0.5 rounded-lg border border-line-2 p-0.5 text-[11px]">
              {(['mc', 'price'] as const).map((m) => (
                <button key={m} onClick={() => setMetric(m)} className={`rounded-md px-2 py-0.5 ${metric === m ? 'bg-line-2 text-text' : 'text-muted'}`}>
                  {m === 'mc' ? 'Market cap' : 'Price'}
                </button>
              ))}
            </span>
          </div>
          <label className="flex flex-col gap-1.5 text-[11px] text-muted">
            {metric === 'mc' ? 'Market cap reaches (USD)' : 'Price reaches (USD)'}
            <input className="input num h-10 text-sm" inputMode="decimal" placeholder={now ? String(metric === 'mc' ? Math.round(now) : now) : ''} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
            <span className="num text-faint">Now {metric === 'mc' ? fmtUsd(mcUsd) : `$${fmtPrice(priceUsd)}`}</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button key={q} onClick={() => setValue(String(q))} className="chip h-7 text-[11px]">
                {metric === 'mc' ? fmtUsd(q) : `$${fmtPrice(q)}`}
              </button>
            ))}
          </div>
          <button className="btn-lime h-10 text-sm" disabled={!value || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Setting…' : 'Set alert'}
          </button>
          {count > 0 && (
            <div className="flex flex-col gap-1 border-t border-line pt-2.5">
              {alerts.data!.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span className="text-text-2">
                    {a.metric === 'mc' ? 'MC' : 'Price'} {a.direction} <span className="num text-text">{a.metric === 'mc' ? fmtUsd(a.value) : `$${fmtPrice(a.value)}`}</span>
                  </span>
                  <button onClick={() => remove.mutate(a.id)} className="ml-auto text-[11px] text-faint hover:text-down-2">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { pctText, usdText, type PnlCardData } from '@/lib/pnl-card';
import { useSession } from '@/lib/session';
import { toast } from './toaster';

/** Button + dialog: preview the PnL card, download it, copy the link or post it on X. */
export function ShareCardButton({ chain, token, className = '' }: { chain: ChainId; token: string; className?: string }) {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className={className || 'text-xs text-muted hover:text-text'}>
        Share PnL card
      </button>
      {open && <ShareDialog handle={me.handle} chain={chain} token={token} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ handle, chain, token, onClose }: { handle: string; chain: ChainId; token: string; onClose: () => void }) {
  const data = useQuery({ queryKey: ['pnl-card', handle, chain, token], queryFn: () => api<PnlCardData>(`/cards/pnl/${handle}/${chain}/${token}`), retry: false });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const img = `/card/pnl/${handle}/${chain}/${token}`;
  const page = `${origin}/s/${handle}/${chain}/${token}`;
  const d = data.data;
  const text = d ? `${pctText(d.pnlPct)} on $${d.symbol} (${(d.pnlUsd >= 0 ? '+' : '') + usdText(d.pnlUsd)}) on Magura. Join with my link for 10% off fees:` : '';
  const copy = async () => {
    await navigator.clipboard.writeText(`${text} ${page}`);
    toast({ title: 'Copied', body: 'Paste it anywhere', tone: 'lime' });
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Share PnL card" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel flex w-full max-w-[640px] flex-col gap-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-[17px] font-semibold">Share your PnL</h2>
          <button onClick={onClose} className="ml-auto text-sm text-muted hover:text-text">
            Close
          </button>
        </div>
        {data.isError ? (
          <p className="py-10 text-center text-sm text-muted">No confirmed trades on this coin yet. Your card shows up after your first trade lands.</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="Your PnL card" className="aspect-[1200/630] w-full rounded-xl border border-line bg-raised" />
        )}
        <p className="text-xs text-muted">Your invite link is on the card. Friends who join with it pay 10% less, and you earn 25% of their fees.</p>
        <div className="grid grid-cols-3 gap-2">
          <a href={img} download={`magura-${d?.symbol ?? 'pnl'}.png`} className="btn-ghost h-10 text-xs">
            Download
          </a>
          <button onClick={copy} disabled={!d} className="btn-ghost h-10 text-xs">
            Copy link
          </button>
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(page)}`}
            target="_blank"
            rel="noreferrer"
            className={`btn-lime h-10 text-xs ${d ? '' : 'pointer-events-none opacity-50'}`}
          >
            Post on X
          </a>
        </div>
      </div>
    </div>
  );
}

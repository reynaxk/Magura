'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PairSummary } from '@magura/shared';
import { api } from '@/lib/api';
import { usePref } from '@/lib/prefs';
import { toast } from './toaster';

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;

function typing(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

const ROWS: [string, string][] = [
  ['Paste a contract', 'Open that coin from anywhere'],
  ['/', 'Search coins'],
  ['1 – 4', 'Buy preset amounts (coin page)'],
  ['Q W E R', 'Sell preset % (coin page)'],
  ['Esc', 'Close panels and dialogs'],
  ['?', 'Show this list'],
];

/** App-wide keyboard layer: paste-to-open, "/" search, "?" help. */
export function Shortcuts() {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const [hotkeys, setHotkeys] = usePref<boolean>('hotkeys', true);

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const text = e.clipboardData?.getData('text')?.trim() ?? '';
      if (SOL_ADDR.test(text)) {
        e.preventDefault();
        router.push(`/t/solana/${text}`);
        return;
      }
      if (EVM_ADDR.test(text)) {
        e.preventDefault();
        try {
          const hits = await api<PairSummary[]>(`/market/search?q=${text}`);
          const hit = hits.find((p) => p.baseToken.address.toLowerCase() === text.toLowerCase()) ?? hits[0];
          if (hit) router.push(`/t/${hit.chain}/${hit.baseToken.address}`);
          else toast({ title: 'Coin not found', body: 'No pool for that contract on Base, BNB or Ethereum yet' });
        } catch {
          toast({ title: 'Lookup failed', body: 'Try again in a moment' });
        }
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        window.dispatchEvent(new Event('magura:search'));
      } else if (e.key === '?') {
        e.preventDefault();
        setHelp((v) => !v);
      } else if (e.key === 'Escape') setHelp(false);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [router]);

  if (!help) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setHelp(false)}>
      <div className="panel flex w-full max-w-md flex-col gap-1 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-[17px] font-semibold">Keyboard shortcuts</h2>
        {ROWS.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-line py-2.5 text-sm last:border-0">
            <span className="text-text-2">{v}</span>
            <kbd className="num rounded-md border border-line-3 bg-raised px-2 py-0.5 text-xs">{k}</kbd>
          </div>
        ))}
        <label className="mt-3 flex items-center justify-between text-sm text-text-2">
          Trading hotkeys
          <input type="checkbox" checked={hotkeys} onChange={(e) => setHotkeys(e.target.checked)} className="h-[18px] w-[18px] accent-lime" />
        </label>
      </div>
    </div>
  );
}

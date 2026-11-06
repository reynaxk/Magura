'use client';

import { soundFor } from '@/lib/sounds';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CHAINS, DEFAULT_PRESETS, type ChainId, type SwapQuote, type SwapTx, type TradePreset } from '@magura/shared';
import { api } from './api';
import { useSession } from './session';
import { toast } from '@/components/toaster';

type Quote = SwapQuote & { quoteId: string; amountUsd: number | null };

export interface TradeTarget {
  chain: ChainId;
  token: string;
  symbol: string;
}

function errorToast(e: unknown) {
  const msg = (e as Error).message ?? 'Unknown error';
  if (msg.startsWith('min_trade')) return toast({ title: 'Trade too small', body: 'The minimum trade on Magura is $2' });
  if (/gas/i.test(msg)) return toast({ title: 'Not enough for gas', body: msg });
  if (/reject|denied|cancel/i.test(msg)) return toast({ title: 'Cancelled', body: 'You declined the transaction in your wallet' });
  toast({ title: 'Trade failed', body: msg.replace(/_/g, ' ') });
}

/** Presets P1–P3, stored on the account so desktop and phone stay in sync. */
export function usePresets() {
  const { me, refresh } = useSession();
  const presets: TradePreset[] = (me?.settings?.tradePresets as TradePreset[] | null) ?? DEFAULT_PRESETS;
  const active = Number(me?.settings?.activePreset ?? 0);
  const save = useCallback(
    async (patch: { tradePresets?: TradePreset[]; activePreset?: number }) => {
      if (!me) return;
      await api('/me/settings', { method: 'PATCH', body: patch });
      refresh();
    },
    [me, refresh],
  );
  return { presets, active, preset: presets[active] ?? presets[0], setActive: (i: number) => save({ activePreset: i }), save };
}

/**
 * One-click trading: quote → build → wallet signs → record, with a single status toast.
 * Buys take a native amount ("0.5"); sells take a percent of the wallet's on-chain balance.
 */
export function useInstantTrade(target: TradeTarget | null) {
  const { me, login, addressFor, sendSwap } = useSession();
  const qc = useQueryClient();
  const { preset } = usePresets();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (side: 'buy' | 'sell', value: string | number, opts: { source?: 'manual' | 'quickbuy'; share?: boolean } = {}) => {
      if (!target) return;
      if (!me) return login();
      const wallet = addressFor(target.chain);
      if (!wallet) return toast({ title: 'No wallet', body: `Connect a ${CHAINS[target.chain].kind === 'svm' ? 'Solana' : 'EVM'} wallet first` });
      const key = `${side}:${value}`;
      setBusy(key);
      const started = performance.now();
      try {
        let amount: string;
        if (side === 'buy') amount = String(value);
        else {
          const bal = await api<{ amount: string | null }>(`/me/balance?chain=${target.chain}&token=${encodeURIComponent(target.token)}`);
          if (!bal.amount || bal.amount === '0') throw new Error(`You don't hold any ${target.symbol}`);
          const pct = Number(value);
          amount = pct >= 100 ? bal.amount : ((BigInt(bal.amount) * BigInt(Math.round(pct * 100))) / 10_000n).toString();
        }
        const quote = await api<Quote>('/swap/quote', {
          body: {
            chain: target.chain,
            side,
            token: target.token,
            amount,
            slippageBps: preset.slippageBps,
            wallet,
            ...(target.chain === 'solana' && preset.priorityFeeSol ? { priorityFeeSol: Number(preset.priorityFeeSol) } : {}),
          },
        });
        const tx = await api<SwapTx>('/swap/build', { body: { quoteId: quote.quoteId } });
        const txHash = await sendSwap(tx);
        soundFor(side);
        await api('/trades', {
          body: {
            quoteId: quote.quoteId,
            chain: target.chain,
            side,
            tokenAddress: target.token,
            tokenSymbol: target.symbol,
            txHash,
            shareToRoom: opts.share ?? true,
            source: opts.source ?? 'manual',
          },
        });
        if (side === 'buy') {
          try {
            localStorage.setItem(`magura:last-buy:${target.chain}`, JSON.stringify(String(value)));
            window.dispatchEvent(new Event('magura:last-buy'));
          } catch {
            /* ignore */
          }
        }
        const secs = ((performance.now() - started) / 1000).toFixed(1);
        const label = side === 'buy' ? `Bought ${target.symbol}` : `Sold ${value}% of ${target.symbol}`;
        toast({ title: label, body: `Sent in ${secs}s${quote.amountUsd ? ` · $${quote.amountUsd.toFixed(2)}` : ''} — confirming on-chain`, tone: 'lime' });
        qc.invalidateQueries({ queryKey: ['portfolio'] });
      } catch (e) {
        errorToast(e);
      } finally {
        setBusy(null);
      }
    },
    [target, me, login, addressFor, sendSwap, preset.slippageBps, qc],
  );

  const buyAmounts = useMemo(() => (target ? preset.buy[target.chain] ?? DEFAULT_PRESETS[0].buy[target.chain] : []), [preset, target]);
  return { run, busy, buyAmounts, sellPcts: preset.sell, slippageBps: preset.slippageBps, native: target ? CHAINS[target.chain].nativeSymbol : '' };
}

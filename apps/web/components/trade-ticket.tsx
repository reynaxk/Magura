'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CHAINS, bpsToPct, fromBaseUnits, nextTier, type ChainId, type SwapQuote, type SwapTx } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from './toaster';
import { Icon, Svg } from './ui';
import { ActiveOrders, LimitBuyForm, TpSlForm } from './orders';
import { ShareCardButton } from './share-card';

type Quote = SwapQuote & { quoteId: string; amountUsd: number | null };

/** Spot buy/sell ticket. Quote → build → wallet signs → API records & confirms. */
export function TradeTicket({ chain, token, symbol, decimals = 6, mcUsd = null }: { chain: ChainId; token: string; symbol: string; decimals?: number; mcUsd?: number | null }) {
  const [mode, setMode] = useState<'market' | 'limit' | 'tpsl'>('market');
  const { me, login, addressFor, sendSwap } = useSession();
  const qc = useQueryClient();
  const native = CHAINS[chain].nativeSymbol;
  const presets = (me?.settings?.quickBuyAmounts ?? {}) as Record<string, string>;
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState(presets[chain] ?? '0.5');
  const [share, setShare] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const slippageBps = Number(me?.settings?.slippageBps ?? 100);
  const wallet = addressFor(chain);

  useEffect(() => setQuote(null), [side, amount, chain, token]);

  async function getQuote() {
    if (!me) return login();
    if (!wallet)
      return toast({
        title: 'No wallet',
        body: `Connect a ${CHAINS[chain].kind === 'svm' ? 'Solana' : 'EVM'} wallet first`,
      });
    setBusy(true);
    try {
      // sells are entered in token units → convert to base units
      const amt = side === 'buy' ? amount : BigInt(Math.floor(Number(amount) * 10 ** decimals)).toString();
      setQuote(
        await api<Quote>('/swap/quote', {
          body: { chain, side, token, amount: amt, slippageBps, wallet },
        }),
      );
    } catch (e) {
      const msg = (e as Error).message;
      const gas = /gas/i.test(msg);
      toast({
        title: msg.startsWith('min_trade') ? 'Trade too small' : gas ? 'Not enough for gas' : 'No route',
        body: msg.startsWith('min_trade') ? 'The minimum trade on Magura is $2' : gas ? msg : msg.replace(/_/g, ' '),
      });
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!quote) return;
    setBusy(true);
    try {
      const tx = await api<SwapTx>('/swap/build', {
        body: { quoteId: quote.quoteId },
      });
      const txHash = await sendSwap(tx);
      await api('/trades', {
        body: {
          quoteId: quote.quoteId,
          chain,
          side,
          tokenAddress: token,
          tokenSymbol: symbol,
          txHash,
          shareToRoom: share,
          source: 'manual',
        },
      });
      toast({
        title: side === 'buy' ? `Bought ${symbol}` : `Sold ${symbol}`,
        body: 'Submitted — confirming on-chain',
        tone: 'lime',
      });
      setQuote(null);
      qc.invalidateQueries({ queryKey: ['portfolio'] });
    } catch (e) {
      toast({ title: 'Trade failed', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const outHuman = quote ? fromBaseUnits(quote.outAmount, side === 'buy' ? decimals : CHAINS[chain].kind === 'svm' ? 9 : 18) : null;

  return (
    <section aria-label="Trade ticket" className="panel flex flex-col gap-3.5 p-[18px]">
      <div role="tablist" aria-label="Order type" className="flex gap-4 border-b border-line text-[13px] font-semibold">
        {(
          [
            ['market', 'Market'],
            ['limit', 'Limit'],
            ['tpsl', 'TP / SL'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`-mb-px border-b-2 pb-2.5 ${mode === id ? 'border-lime text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'limit' && <LimitBuyForm chain={chain} token={token} symbol={symbol} mcUsd={mcUsd} />}
      {mode === 'tpsl' && <TpSlForm chain={chain} token={token} symbol={symbol} />}
      {mode === 'market' && (
        <>
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-raised p-1">
            {(['buy', 'sell'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`h-10 rounded-[9px] text-sm font-semibold ${side === s ? (s === 'buy' ? 'bg-lime text-bg' : 'bg-down text-bg') : 'text-text-2'}`}
              >
                {s === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            {side === 'buy' ? `Amount (${native})` : `Amount (${symbol})`}
            <input className="input num h-12 text-[15px]" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          {side === 'buy' && (
            <div className="flex gap-1.5">
              {['0.1', '0.5', '1', '2'].map((v) => (
                <button key={v} onClick={() => setAmount(v)} className={amount === v ? 'chip-on' : 'chip'}>
                  {v}
                </button>
              ))}
            </div>
          )}
          {quote && (
            <div className="flex flex-col gap-1.5 rounded-xl bg-raised p-3 text-xs">
              <div className="flex justify-between text-muted">
                <span>You receive</span>
                <span className="num text-text">
                  ≈{' '}
                  {outHuman?.toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}{' '}
                  {side === 'buy' ? symbol : native}
                </span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Value</span>
                <span className="num text-text">{quote.amountUsd ? `$${quote.amountUsd.toFixed(2)}` : '—'}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Magura fee</span>
                <span className="num text-text">{quote.fee.bps ? `${bpsToPct(quote.fee.bps)} · $${(quote.fee.usd ?? 0).toFixed(2)}` : '—'}</span>
              </div>
              {quote.amountUsd != null && nextTier(chain, quote.amountUsd) && (
                <div className="text-[11px] text-lime">
                  Trade ${nextTier(chain, quote.amountUsd)!.atUsd}+ to pay {bpsToPct(nextTier(chain, quote.amountUsd)!.bps)}
                </div>
              )}
              <div className="flex justify-between text-muted">
                <span>Slippage · route</span>
                <span className="num text-text">
                  {(slippageBps / 100).toFixed(1)}% · {quote.provider}
                </span>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2.5 text-[13px] text-text-2">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="h-[18px] w-[18px] accent-lime" />
            Share this trade to the coin room
          </label>
          <button onClick={quote ? execute : getQuote} disabled={busy} className={`btn h-12 rounded-[14px] text-[15px] ${side === 'buy' ? 'bg-lime text-bg' : 'bg-down text-bg'}`}>
            <Svg d={Icon.bolt} size={16} />
            {busy ? 'Working…' : quote ? `Confirm ${side} ${symbol}` : `Get quote`}
          </button>
        </>
      )}
      <ActiveOrders chain={chain} token={token} symbol={symbol} />
      <ShareCardButton chain={chain} token={token} className="self-center text-xs text-muted hover:text-text" />
    </section>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { CHAINS, fmtAge, fmtPrice, fmtUsd, type ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useInstantTrade } from '@/lib/trade';
import { Empty, Icon } from './ui';

interface Position {
  open: boolean;
  avgPriceUsd: number | null;
  costUsd: number;
  soldUsd: number;
  realizedUsd: number;
  holding: number | null;
  boughtUsd: number;
  buys: number;
  sells: number;
  trades: { id: string; side: string; amountUsd: number; priceUsd: number | null; txHash: string | null; at: string }[];
}

/** Your position in this coin: value, entry, PnL, quick sells and every trade you made. */
export function PositionTab({ chain, address, symbol, priceUsd }: { chain: ChainId; address: string; symbol: string; priceUsd: number | null }) {
  const { me, login } = useSession();
  const q = useQuery({ queryKey: ['position', chain, address], queryFn: () => api<Position>(`/me/position/${chain}/${address}`), enabled: !!me, refetchInterval: 15_000 });
  const { run, busy } = useInstantTrade({ chain, token: address, symbol });
  if (!me)
    return (
      <Empty icon={Icon.trend} title="Log in to see your position">
        <button className="btn-lime mt-2 h-9 px-4 text-xs" onClick={login}>
          Log in
        </button>
      </Empty>
    );
  const p = q.data;
  if (p && !p.buys) return <Empty icon={Icon.trend} title={`You haven't traded ${symbol}`}>Buy from the trade box — your entry, PnL and exits show up here.</Empty>;
  const value = p?.holding != null && priceUsd != null ? p.holding * priceUsd : null;
  const unrealized = value != null && p ? value - p.costUsd : null;
  const total = (p?.realizedUsd ?? 0) + (unrealized ?? 0);
  const pct = p && p.boughtUsd > 0 ? (total / p.boughtUsd) * 100 : null;
  const tone = (v: number | null) => (v == null ? 'text-text' : v >= 0 ? 'text-lime' : 'text-down-2');
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="num grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Holding', value != null ? fmtUsd(value) : p?.open ? '…' : '—', 'text-text'],
          ['Avg entry', p?.avgPriceUsd ? `$${fmtPrice(p.avgPriceUsd)}` : '—', 'text-text'],
          ['Unrealized', unrealized != null ? `${unrealized >= 0 ? '+' : ''}${fmtUsd(unrealized)}` : '—', tone(unrealized)],
          ['Realized', p ? `${p.realizedUsd >= 0 ? '+' : ''}${fmtUsd(p.realizedUsd)}` : '—', tone(p?.realizedUsd ?? null)],
          ['Total PnL', p ? `${total >= 0 ? '+' : ''}${fmtUsd(total)}` : '—', tone(total)],
          ['Return', pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—', tone(pct)],
          ['Bought', p ? `${fmtUsd(p.boughtUsd)} · ${p.buys}×` : '—', 'text-text'],
          ['Sold', p ? `${fmtUsd(p.soldUsd)} · ${p.sells}×` : '—', 'text-text'],
        ].map(([k, v, c]) => (
          <div key={k} className="flex flex-col gap-0.5 rounded-xl bg-raised p-2.5">
            <span className="text-[10.5px] text-muted">{k}</span>
            <span className={`text-[13px] font-semibold ${c}`}>{v}</span>
          </div>
        ))}
      </div>
      {p?.open && (
        <div className="grid grid-cols-4 gap-1.5">
          {[25, 50, 75, 100].map((n) => (
            <button key={n} disabled={!!busy} onClick={() => run('sell', n)} className="num h-9 rounded-lg border border-[#3A1D25] bg-down-dim text-xs font-semibold text-down-2 hover:brightness-125">
              Sell {n}%
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col rounded-xl border border-line">
        {p?.trades.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-line px-3 py-2 text-[12px] last:border-0">
            <span className={`num w-10 font-semibold ${t.side === 'buy' ? 'text-lime' : 'text-down-2'}`}>{t.side.toUpperCase()}</span>
            <span className="num flex-1">{fmtUsd(t.amountUsd)}</span>
            <span className="num text-text-2">{t.priceUsd ? `@ $${fmtPrice(t.priceUsd)}` : ''}</span>
            {t.txHash && (
              <a href={`${CHAINS[chain].explorer}/tx/${t.txHash}`} target="_blank" rel="noreferrer" className="text-[11px] text-faint hover:text-text">
                tx ↗
              </a>
            )}
            <span className="num w-10 text-right text-[10px] text-faint">{fmtAge(t.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

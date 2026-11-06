'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHAINS, fmtAge, fmtUsd, type ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/components/toaster';
import { TagPill } from '@/components/wallet-tables';
import { Avatar, Empty, Icon, Segmented } from '@/components/ui';

interface Stats {
  pnl: number;
  buys: number;
  sells: number;
  winRate: number | null;
  volume: number;
  coins: number;
}
interface WalletPage {
  wallet: string;
  handle: string | null;
  smart: boolean;
  windows: Record<'1d' | '7d' | '30d', Stats>;
  holdings: { address: string; symbol: string; imageUrl: string | null; balance: number; spent: number; received: number; marketCapUsd: number | null }[];
  trades: { address: string; symbol: string; imageUrl: string | null; side: 'buy' | 'sell'; native: number; tokens: number; realized: number; at: string }[];
}

/** Any wallet's profile: PnL, win rate, what it holds and every recent trade. */
export default function WalletProfile({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = use(params);
  const c = chain as ChainId;
  const { me, login } = useSession();
  const [w, setW] = useState<'1d' | '7d' | '30d'>('7d');
  const q = useQuery({ queryKey: ['wallet-page', chain, address], queryFn: () => api<WalletPage>(`/market/wallet/${chain}/${address}`), refetchInterval: 20_000 });
  const d = q.data;
  const s = d?.windows[w];
  const native = CHAINS[c]?.nativeSymbol ?? 'SOL';
  const track = async () => {
    if (!me) return login();
    await api('/me/tracked', { body: { address, label: `${address.slice(0, 4)}…${address.slice(-4)}` } });
    toast({ title: 'Wallet tracked', body: 'Its trades show up labelled everywhere on Magura', tone: 'lime' });
  };
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 p-3 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Avatar name={d?.handle ?? address} size={52} shape="circle" />
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="num text-[20px] font-semibold">{d?.handle ? `@${d.handle}` : `${address.slice(0, 6)}…${address.slice(-6)}`}</h1>
            {d?.smart && <TagPill tag="smart" />}
          </div>
          <span className="flex items-center gap-3 text-[12px] text-muted">
            <button onClick={() => navigator.clipboard?.writeText(address)} className="num hover:text-text">
              Copy address
            </button>
            <a href={`${CHAINS[c]?.explorer}/account/${address}`} target="_blank" rel="noreferrer" className="hover:text-text">
              Explorer ↗
            </a>
          </span>
        </div>
        <span className="ml-auto flex gap-2">
          <button onClick={track} className="btn-ghost h-10 text-sm">
            Track
          </button>
          <Link href={`/smart`} className="btn-lime h-10 text-sm">
            Smart money
          </Link>
        </span>
      </header>

      <section className="panel flex flex-col gap-3 p-4">
        <Segmented label="Window" value={w} onChange={setW} options={(['1d', '7d', '30d'] as const).map((v) => ({ value: v, label: v.toUpperCase() }))} />
        <div className="num grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ['Realized PnL', s ? `${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)} ${native}` : '—', s && s.pnl < 0 ? 'text-down-2' : 'text-lime'],
            ['Win rate', s?.winRate != null ? `${s.winRate}%` : '—', 'text-text'],
            ['Buys / sells', s ? `${s.buys} / ${s.sells}` : '—', 'text-text'],
            ['Volume', s ? `${s.volume.toFixed(1)} ${native}` : '—', 'text-text'],
            ['Coins', s ? String(s.coins) : '—', 'text-text'],
          ].map(([k, v, cls]) => (
            <div key={k} className="flex flex-col gap-0.5 rounded-xl bg-raised p-3">
              <span className="text-[11px] text-muted">{k}</span>
              <span className={`text-[16px] font-semibold ${cls}`}>{v}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-4">
        <section className="panel min-w-0 flex-[1_1_320px] overflow-hidden">
          <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Holding</h2>
          {d?.holdings.map((h) => (
            <Link key={h.address} href={`/t/${chain}/${h.address}`} className="flex items-center gap-2.5 border-b border-[#151820] px-4 py-2 hover:bg-hover">
              <Avatar name={h.symbol} src={h.imageUrl} size={26} />
              <span className="flex-1 text-[13px] font-semibold">{h.symbol}</span>
              <span className="num text-[11px] text-muted">
                in {h.spent.toFixed(2)} · out {h.received.toFixed(2)} {native}
              </span>
              <span className="num text-[11px] text-text-2">MC {fmtUsd(h.marketCapUsd)}</span>
            </Link>
          ))}
          {d && !d.holdings.length && <p className="p-4 text-[12px] text-muted">Nothing open in coins we track.</p>}
        </section>
        <section className="panel min-w-0 flex-[2_1_480px] overflow-hidden">
          <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Recent trades</h2>
          <div className="scroll-thin max-h-[520px] overflow-auto">
            {d?.trades.map((t, i) => (
              <Link key={i} href={`/t/${chain}/${t.address}`} className="flex items-center gap-2.5 border-b border-[#151820] px-4 py-2 hover:bg-hover">
                <span className={`num w-10 text-[11px] font-semibold ${t.side === 'buy' ? 'text-lime' : 'text-down-2'}`}>{t.side.toUpperCase()}</span>
                <Avatar name={t.symbol} src={t.imageUrl} size={22} />
                <span className="flex-1 text-[13px] font-semibold">{t.symbol}</span>
                <span className="num text-[12px]">
                  {t.native.toFixed(3)} {native}
                </span>
                {t.side === 'sell' && <span className={`num w-24 text-right text-[11px] ${t.realized >= 0 ? 'text-lime' : 'text-down-2'}`}>{`${t.realized >= 0 ? '+' : ''}${t.realized.toFixed(3)}`}</span>}
                <span className="num w-12 text-right text-[10px] text-faint">{fmtAge(t.at)}</span>
              </Link>
            ))}
            {d && !d.trades.length && <Empty icon={Icon.trend} title="No trades seen yet">We record wallets as they trade coins we track.</Empty>}
          </div>
        </section>
      </div>
    </div>
  );
}

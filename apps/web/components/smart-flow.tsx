'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fmtAge, fmtUsd } from '@magura/shared';
import { api } from '@/lib/api';
import { Avatar, Delta, Empty, Icon, Segmented } from './ui';

interface Flow {
  address: string;
  smartBuySol: number;
  smartWallets: number;
  token: { symbol: string; name: string; imageUrl: string | null; marketCapUsd: number | null; createdAt: string; priceChange1h: number | null };
}

/** Coins smart wallets are buying, by window. */
export function SmartFlow({ compact = false }: { compact?: boolean }) {
  const [m, setM] = useState<'5' | '15' | '60' | '240'>('60');
  const q = useQuery({ queryKey: ['smart-flow', m], queryFn: () => api<Flow[]>(`/market/smart/flow?m=${m}`), refetchInterval: 15_000 });
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Segmented
          label="Window"
          value={m}
          onChange={setM}
          options={[
            { value: '5', label: '5m' },
            { value: '15', label: '15m' },
            { value: '60', label: '1h' },
            { value: '240', label: '4h' },
          ]}
        />
        <span className="text-xs text-muted">{compact ? 'Smart flow' : 'Coins smart wallets are buying'}</span>
      </div>
      {q.data?.map((f) => (
        <Link key={f.address} href={`/t/solana/${f.address}`} className="flex items-center gap-3 border-b border-[#151820] px-3 py-2 hover:bg-hover">
          <Avatar name={f.token.symbol} src={f.token.imageUrl} size={32} />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-[13px] font-semibold">{f.token.symbol}</span>
            <span className="num text-[11px] text-muted">
              {fmtAge(f.token.createdAt)} · MC {fmtUsd(f.token.marketCapUsd)}
            </span>
          </span>
          {!compact && (
            <span className="text-[12px]">
              <Delta value={f.token.priceChange1h} />
            </span>
          )}
          <span className={`num text-right text-[12px] text-lime ${compact ? "" : "w-28"}`}>+{f.smartBuySol.toFixed(2)} SOL</span>
          <span className="num w-20 text-right text-[11px] text-text-2">{f.smartWallets} smart</span>
        </Link>
      ))}
      {q.data?.length === 0 && <Empty icon={Icon.trend} title="No smart buying in this window">Smart wallets are picked from the 7-day leaderboard every 5 minutes.</Empty>}
    </section>
  );
}


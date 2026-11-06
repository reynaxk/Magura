'use client';

import { memo } from 'react';
import { fmtAge, fmtUsd, tagMeta, type TrenchToken, type WalletTag } from '@magura/shared';
import type { TrenchPrefs } from '@/lib/trench-prefs';
import { Avatar, Icon, Svg } from './ui';
import { Star } from './star';

/** Pro layout: one coin in two tight lines — everything a sniper needs at a glance. */
function Mini({ tag, v, warn }: { tag: WalletTag | 'top10'; v: number | null | undefined; warn: number }) {
  const label = tag === 'top10' ? 'T10' : tagMeta(tag).short;
  const tone = v == null ? 'text-faint' : v === 0 ? 'text-lime' : v > warn ? 'text-down-2' : 'text-amber';
  return (
    <span className="num flex items-center gap-0.5 text-[10px]" title={`${label} ${v ?? '—'}%`}>
      <span className="text-faint">{label}</span>
      <span className={tone}>{v == null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`}</span>
    </span>
  );
}

export const TrenchRow = memo(function TrenchRow({
  t,
  accent,
  prefs,
  amount,
  onOpen,
  onBuy,
  buying,
}: {
  t: TrenchToken;
  accent: string;
  prefs: TrenchPrefs;
  amount: string;
  onOpen: () => void;
  onBuy: (amount: string) => void;
  buying: boolean;
}) {
  const i = t.intel ?? null;
  const pct = Math.max(0, Math.min(100, t.bondingPct ?? 0));
  const holders = i?.holders ?? t.holders;
  return (
    <article onClick={onOpen} className="group relative flex cursor-pointer gap-2.5 border-b border-line px-2.5 py-2 transition-colors hover:bg-hover">
      <span className="relative shrink-0">
        <Avatar name={t.symbol} src={t.imageUrl} size={40} shape={prefs.logo === 'circle' ? 'circle' : undefined} />
        {t.stage !== 'survived' && t.bondingPct != null && (
          <span className="absolute inset-x-0 -bottom-1 h-[3px] overflow-hidden rounded-full bg-line">
            <span className="block h-full" style={{ width: `${pct}%`, background: accent }} />
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Star chain={t.chain} address={t.address} size={11} />
          <span className="text-[13px] font-semibold">{t.symbol}</span>
          <span className="min-w-0 truncate text-[11px] text-muted">{t.name}</span>
          <span className="num shrink-0 text-[10.5px] text-lime">{fmtAge(t.createdAt)}</span>
          {t.hasX && <Svg d="M4 4l16 16M20 4L4 20" size={10} color="#7A8397" />}
          {t.hasTelegram && <Svg d="M21 4L3 11l6 2 2 6 3-4 5 4z" size={10} color="#7A8397" />}
          {t.hasWebsite && <Svg d={Icon.globe} size={10} color="#7A8397" />}
          {t.dexPaid && <span className="shrink-0 rounded bg-sky/15 px-1 text-[9px] font-bold text-sky">DS</span>}
          {(t.devSold || i?.devSoldAll) && <span className="shrink-0 rounded bg-down-dim px-1 text-[9px] font-bold text-down-2">DEV SOLD</span>}
          {t.chatCount > 0 && (
            <span className="num flex shrink-0 items-center gap-0.5 text-[10px] text-text-2">
              <Svg d={Icon.chat} size={10} />
              {t.chatCount}
            </span>
          )}
          {t.friendsBought.length > 0 && <span className="shrink-0 truncate text-[10px] text-lime">{t.friendsBought[0].handle} aped</span>}
        </div>
        <div className="num flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap text-[10.5px] text-muted">
          <span>
            V <span className="text-text-2">{fmtUsd(t.volumeUsd)}</span>
          </span>
          {holders != null && (
            <span>
              <span className="text-text-2">{holders}</span>h
            </span>
          )}
          {t.buys5m != null && (
            <span>
              <span className="text-lime">{t.buys5m}</span>/<span className="text-down-2">{t.sells5m ?? 0}</span>
            </span>
          )}
          <Mini tag="top10" v={i?.top10Pct ?? t.risk?.top10Pct} warn={prefs.warn.top10} />
          <Mini tag="dev" v={i?.devPct ?? t.risk?.devPct} warn={prefs.warn.dev} />
          <Mini tag="sniper" v={i?.sniperPct ?? t.risk?.sniperPct} warn={prefs.warn.snipers} />
          <Mini tag="bundler" v={i?.bundlerPct} warn={prefs.warn.bundlers} />
          <Mini tag="insider" v={i?.insiderPct} warn={prefs.warn.insiders} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1">
        <span className="num text-[12px] font-semibold">
          <span className="text-[10px] font-normal text-faint">MC </span>
          {fmtUsd(t.marketCapUsd)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBuy(amount);
          }}
          disabled={buying}
          aria-label={`Quick buy ${t.symbol} for ${amount}`}
          className="num flex h-6 items-center gap-0.5 rounded-md bg-lime-dim px-2 text-[11px] font-semibold text-lime ring-1 ring-lime-line transition hover:bg-lime hover:text-bg"
        >
          <Svg d={Icon.bolt} size={10} />
          {buying ? '…' : amount}
        </button>
      </div>
    </article>
  );
});

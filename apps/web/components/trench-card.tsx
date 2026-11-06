'use client';

import { memo } from 'react';
import { fmtAge, fmtUsd, tagMeta, type TrenchToken, type WalletTag } from '@magura/shared';
import type { CardField, TrenchPrefs } from '@/lib/trench-prefs';
import { Avatar, ChatBadge, Icon, RiskTags, Svg } from './ui';

const SIZES = {
  compact: { logo: 40, pad: 'p-2.5', gap: 'gap-1.5', title: 'text-[13px]' },
  comfy: { logo: 52, pad: 'p-3', gap: 'gap-2', title: 'text-sm' },
  large: { logo: 64, pad: 'p-3.5', gap: 'gap-2.5', title: 'text-[15px]' },
} as const;

const BTN = { sm: 'h-7 px-2 text-[11px]', md: 'h-8 px-2.5 text-xs', lg: 'h-10 px-3.5 text-sm' } as const;

/** Bonding progress drawn around the logo. */
function Ring({ pct, size, color, children }: { pct: number | null; size: number; color: string; children: React.ReactNode }) {
  const r = size / 2 + 3;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size + 8, height: size + 8 }}>
      <svg width={size + 8} height={size + 8} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={r + 1} cy={r + 1} r={r} fill="none" stroke="#1C2029" strokeWidth="2" />
        {pct != null && <circle cx={r + 1} cy={r + 1} r={r} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />}
      </svg>
      <span className="absolute inset-1">{children}</span>
    </span>
  );
}

/** One supply chip: "BND 12%". Green when 0, amber under the warn line, red above. */
function Chip({ tag, value, warn, title }: { tag: WalletTag | 'top10'; value: number | null | undefined; warn: number; title: string }) {
  const label = tag === 'top10' ? 'T10' : tagMeta(tag).short;
  const tone = value == null ? 'text-faint' : value === 0 ? 'text-lime' : value > warn ? 'text-down-2' : 'text-amber';
  const bg = value == null ? 'bg-transparent' : value > warn ? 'bg-down-dim' : 'bg-[#12151B]';
  return (
    <span title={`${title}: ${value == null ? 'unknown' : `${value}% of supply`}`} className={`num flex h-[22px] items-center gap-1 rounded-md border border-line-2 px-1.5 text-[10.5px] ${bg}`}>
      <span className="text-faint">{label}</span>
      <span className={`font-semibold ${tone}`}>{value == null ? '—' : `${value < 10 ? value.toFixed(1) : Math.round(value)}%`}</span>
    </span>
  );
}

function Social({ on, d, label }: { on?: boolean; d: string; label: string }) {
  if (!on) return null;
  return (
    <span title={label} className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-raised text-text-2">
      <Svg d={d} size={11} />
    </span>
  );
}

const X_ICON = 'M4 4l16 16M20 4L4 20';
const TG_ICON = 'M21 4L3 11l6 2 2 6 3-4 5 4z';

export const TrenchCard = memo(function TrenchCard({
  t,
  accent,
  selected,
  prefs,
  amount,
  nativeSymbol,
  onSelect,
  onBuy,
  buying,
}: {
  t: TrenchToken;
  accent: string;
  selected: boolean;
  prefs: TrenchPrefs;
  amount: string;
  nativeSymbol: string;
  onSelect: () => void;
  onBuy: (amount: string) => void;
  buying: boolean;
}) {
  const s = SIZES[prefs.size];
  const on = (f: CardField) => prefs.fields.includes(f);
  const i = t.intel ?? null;
  const top10 = i?.top10Pct ?? t.risk?.top10Pct ?? null;
  const dev = i?.devPct ?? t.risk?.devPct ?? null;
  const snipers = i?.sniperPct ?? t.risk?.sniperPct ?? null;
  const holders = i?.holders ?? t.holders;
  const friends = t.friendsBought.slice(0, 3);
  const showRing = prefs.progress === 'ring' && t.stage !== 'survived';
  const logo = <Avatar name={t.symbol} src={t.imageUrl} size={s.logo} shape={prefs.logo === 'circle' ? 'circle' : undefined} />;

  return (
    <article
      onClick={onSelect}
      className={`group card relative flex cursor-pointer flex-col ${s.pad} ${s.gap} transition-colors ${selected ? 'border-lime! bg-[#11161A]' : 'hover:border-line-3 hover:bg-hover'}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          {showRing ? (
            <Ring pct={t.bondingPct} size={s.logo} color={accent}>
              {logo}
            </Ring>
          ) : (
            logo
          )}
          <span className="num absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md border border-line-3 bg-bg px-1 text-[9px] text-text-2">{fmtAge(t.createdAt)}</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={`${s.title} font-semibold`}>{t.symbol}</span>
            <span className="truncate text-xs text-muted">{t.name}</span>
            {t.devSold && (
              <span title="The dev sold" className="shrink-0 rounded-[5px] bg-down-dim px-1 text-[9.5px] font-bold uppercase tracking-wide text-down-2">
                dev sold
              </span>
            )}
          </div>
          {on('socials') && (t.hasX || t.hasTelegram || t.hasWebsite) && (
            <div className="flex items-center gap-1">
              <Social on={t.hasX} d={X_ICON} label="X" />
              <Social on={t.hasTelegram} d={TG_ICON} label="Telegram" />
              <Social on={t.hasWebsite} d={Icon.globe} label="Website" />
            </div>
          )}
          <div className="num flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-muted">
            {on('mc') && (
              <span>
                MC <span className="text-text">{fmtUsd(t.marketCapUsd)}</span>
              </span>
            )}
            {on('vol') && (
              <span>
                V <span className="text-text">{fmtUsd(t.volumeUsd)}</span>
              </span>
            )}
            {on('holders') && holders != null && (
              <span title="Holders">
                <span className="text-text">{holders}</span> hold
              </span>
            )}
            {on('tx') && t.buys5m != null && (
              <span title="Buys / sells, last 5 minutes">
                <span className="text-lime">{t.buys5m}</span>/<span className="text-down-2">{t.sells5m ?? 0}</span>
              </span>
            )}
            {on('ath') && t.athMarketCapUsd != null && (
              <span>
                ATH <span className="text-text-2">{fmtUsd(t.athMarketCapUsd)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onBuy(amount);
            }}
            disabled={buying}
            aria-label={`Quick buy ${t.symbol} for ${amount} ${nativeSymbol}`}
            className={`num flex items-center gap-1 rounded-[10px] bg-lime font-semibold text-bg transition hover:brightness-110 ${BTN[prefs.buttonSize]}`}
          >
            <Svg d={Icon.bolt} size={12} />
            {buying ? '…' : amount}
          </button>
          {prefs.secondBuy && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBuy(prefs.secondAmount);
              }}
              disabled={buying}
              aria-label={`Quick buy ${t.symbol} for ${prefs.secondAmount} ${nativeSymbol}`}
              className={`num flex items-center gap-1 rounded-[10px] border border-lime-line bg-lime-dim font-semibold text-lime ${BTN[prefs.buttonSize]}`}
            >
              <Svg d={Icon.bolt} size={12} />
              {prefs.secondAmount}
            </button>
          )}
        </div>
      </div>

      {(on('top10') || on('dev') || on('snipers') || on('bundlers') || on('insiders') || on('fresh')) && (
        <div className="flex flex-wrap gap-1">
          {on('top10') && <Chip tag="top10" value={top10} warn={prefs.warn.top10} title="Top 10 holders" />}
          {on('dev') && <Chip tag="dev" value={dev} warn={prefs.warn.dev} title="Dev holds" />}
          {on('snipers') && <Chip tag="sniper" value={snipers} warn={prefs.warn.snipers} title="Snipers hold" />}
          {on('bundlers') && <Chip tag="bundler" value={i?.bundlerPct} warn={prefs.warn.bundlers} title="Bundlers hold" />}
          {on('insiders') && <Chip tag="insider" value={i?.insiderPct} warn={prefs.warn.insiders} title="Insiders hold" />}
          {on('fresh') && <Chip tag="fresh" value={i?.freshPct} warn={prefs.warn.fresh} title="Fresh wallets hold" />}
        </div>
      )}

      {(on('chat') || on('friends') || on('audit') || on('launchpad')) && (
        <div className="flex min-w-0 items-center gap-1.5">
          {on('chat') && <ChatBadge count={t.chatCount} />}
          {on('friends') && friends.length > 0 && (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="flex">
                {friends.map((f) => (
                  <span key={f.userId} className="-mr-1.5">
                    <Avatar name={f.handle} src={f.avatarUrl} size={18} shape="circle" ring="#0E1015" />
                  </span>
                ))}
              </span>
              <span className="ml-1.5 truncate text-[11px] text-text-2">
                {friends[0].handle}
                {t.friendsBought.length > 1 ? ` +${t.friendsBought.length - 1}` : ''} aped
              </span>
            </span>
          )}
          {on('audit') && <RiskTags risk={t.risk} />}
          {on('launchpad') && t.launchpad && <span className="ml-auto text-[10px] text-faint">{t.launchpad}</span>}
        </div>
      )}

      {prefs.progress === 'bar' && t.stage !== 'survived' && t.bondingPct != null && (
        <div className="flex items-center gap-2">
          <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-line">
            <div className="h-[4px] rounded-full" style={{ width: `${Math.min(100, t.bondingPct)}%`, background: accent }} />
          </div>
          <span className="num text-[10px] text-text-2">{t.bondingPct.toFixed(0)}%</span>
        </div>
      )}
    </article>
  );
});

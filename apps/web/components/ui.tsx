'use client';

import type { ReactNode } from 'react';
import type { TokenRisk } from '@magura/shared';

const AVATAR_COLORS = ['#E9B07F', '#8FC6E6', '#E7A0B8', '#A2D9BD', '#E3CD8A', '#9D8CFF', '#2FE39A'];

export function colorFor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({
  name,
  src,
  size = 32,
  shape = 'rounded',
  ring,
}: {
  name: string;
  src?: string | null;
  size?: number;
  shape?: 'rounded' | 'circle';
  ring?: string;
}) {
  const radius = shape === 'circle' ? '50%' : `${Math.round(size * 0.3)}px`;
  const style = { width: size, height: size, borderRadius: radius, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined };
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={style} className="shrink-0 object-cover" />;
  return (
    <span
      aria-hidden="true"
      style={{ ...style, background: colorFor(name), fontSize: Math.max(9, size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center font-semibold text-bar"
    >
      {name.replace(/^[@$]/, '').slice(0, 2).toUpperCase()}
    </span>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-4 border-t border-line py-3.5 text-left first:border-t-0"
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <span className={`relative h-[26px] w-11 shrink-0 rounded-full ${on ? 'bg-lime' : 'bg-line-3'}`}>
        <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-text transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-xl border border-line-2 bg-raised p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-[9px] px-3 text-xs font-semibold ${value === o.value ? 'bg-text text-bg' : 'text-muted hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Delta({ value, digits = 1 }: { value: number | null | undefined; digits?: number }) {
  if (value == null || !Number.isFinite(value)) return <span className="num text-muted">—</span>;
  return (
    <span className={`num ${value >= 0 ? 'text-lime' : 'text-down'}`}>
      {value > 0 ? '+' : ''}
      {value.toFixed(digits)}%
    </span>
  );
}

export function Spark({ points, width = 64, height = 26, color = '#2FE39A' }: { points: number[]; width?: number; height?: number; color?: string }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * width).toFixed(1)} ${(height - 3 - ((p - min) / (max - min || 1)) * (height - 6)).toFixed(1)}`)
    .join('');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function tone(v: number, ok: number, warn: number) {
  return v <= ok ? 'border-lime-line text-lime' : v <= warn ? 'border-[#4A3A1E] text-amber' : 'border-down-line text-down-2';
}

export function RiskTags({ risk }: { risk: TokenRisk | null }) {
  if (!risk) return <span className="num text-[10px] text-faint">risk: checking…</span>;
  const tags: { label: string; v: number; ok: number; warn: number }[] = [];
  if (risk.top10Pct != null) tags.push({ label: 'Top10', v: risk.top10Pct, ok: 25, warn: 40 });
  if (risk.devPct != null) tags.push({ label: 'Dev', v: risk.devPct, ok: 3, warn: 6 });
  if (risk.sellTax != null && risk.sellTax > 0) tags.push({ label: 'Tax', v: risk.sellTax, ok: 1, warn: 5 });
  return (
    <span className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t.label} className={`num rounded-md border px-1.5 py-0.5 text-[10px] ${tone(t.v, t.ok, t.warn)}`}>
          {t.label} {t.v.toFixed(0)}%
        </span>
      ))}
      {risk.honeypot && <span className="num rounded-md border border-down-line px-1.5 py-0.5 text-[10px] text-down-2">HONEYPOT</span>}
      {risk.mintable && <span className="num rounded-md border border-[#4A3A1E] px-1.5 py-0.5 text-[10px] text-amber">Mintable</span>}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="text-sm font-semibold">{title}</span>
      {children && <span className="max-w-sm text-sm text-muted">{children}</span>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-raised ${className}`} />;
}

export function LiveDot({ color = '#2FE39A' }: { color?: string }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />;
}

export const Icon = {
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-3.5-3.5',
  bell: 'M6 9a6 6 0 1112 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 004 0',
  send: 'M5 12h14M13 6l6 6-6 6',
  mic: 'M9 3h6v11H9zM5 11a7 7 0 0014 0M12 18v3',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3z',
  screen: 'M3 4h18v13H3zM8 21h8M12 14V8M9 11l3-3 3 3',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  chat: 'M4 5h16v11H9l-5 4z',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 6l-6 6 6 6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  end: 'M3 15c5-5 13-5 18 0l-2 3-4-1v-3c-2-1-4-1-6 0v3l-4 1z',
  pin: 'M9 3h6l-1 6 4 4H6l4-4zM12 13v8',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
} as const;

export function Svg({ d, size = 18, color = 'currentColor', label }: { d: string; size?: number; color?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} />
    </svg>
  );
}

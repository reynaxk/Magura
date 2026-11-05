import { ImageResponse } from 'next/og';
import { pctText, usdText, type RecapData } from '@/lib/pnl-card';

export const runtime = 'edge';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magura.app';

const LOGO = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 120 120">
    <g transform="rotate(-14 60 66)">
      <path d="M10 70 A50 15 0 0 1 110 70" fill="none" stroke="#2FE39A" strokeWidth="6" strokeLinecap="round" opacity="0.9" />
    </g>
    <path d="M30 96 V26 H44 L60 52 L76 26 H90 V96 H78 V48 L60 76 L42 48 V96 Z" fill="#F2F4F3" />
    <g transform="rotate(-14 60 66)">
      <path d="M110 70 A50 15 0 0 1 10 70" fill="none" stroke="#2FE39A" strokeWidth="6" strokeLinecap="round" />
    </g>
    <circle cx="106" cy="46" r="6" fill="#2FE39A" />
  </svg>
);

/** 1200×630 "My month on Magura" card. */
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string; month: string }> }) {
  const { handle, month } = await params;
  const [mono, sans, sansReg, res] = await Promise.all([
    fetch(new URL('../../../../../assets/fonts/GeistMono-SemiBold.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('../../../../../assets/fonts/Geist-SemiBold.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('../../../../../assets/fonts/Geist-Regular.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(`${API}/v1/cards/recap/${encodeURIComponent(handle)}/${month}`, { cache: 'no-store' }),
  ]);
  if (!res.ok) return new Response('Not found', { status: 404 });
  const d = (await res.json()) as RecapData;
  const up = d.realizedUsd >= 0;
  const stat = (k: string, v: string, accent = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      <span style={{ fontFamily: 'Geist', fontSize: 20, color: '#8A93A6' }}>{k}</span>
      <span style={{ fontFamily: 'GeistMono', fontSize: 34, color: accent ? '#2FE39A' : '#E9ECF2' }}>{v}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#08090C', padding: 64, position: 'relative' }}>
        <div style={{ position: 'absolute', right: -120, top: -140, display: 'flex', opacity: 0.06 }}>{LOGO(620)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {LOGO(44)}
          <span style={{ fontFamily: 'GeistSemi', fontSize: 26, letterSpacing: 5, color: '#E9ECF2' }}>MAGURA</span>
          <span style={{ fontFamily: 'Geist', fontSize: 24, color: '#8A93A6', marginLeft: 'auto' }}>@{d.handle}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40, gap: 6 }}>
          <span style={{ fontFamily: 'GeistSemi', fontSize: 40, color: '#E9ECF2' }}>My {d.label} on Magura</span>
          <span style={{ fontFamily: 'GeistMono', fontSize: 120, lineHeight: 1, letterSpacing: -5, color: up ? '#2FE39A' : '#FF6B6B' }}>
            {(up ? '+' : '') + usdText(d.realizedUsd)}
          </span>
          <span style={{ fontFamily: 'Geist', fontSize: 24, color: '#8A93A6' }}>realized{d.roiPct != null ? ` · ${pctText(d.roiPct)} return` : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 'auto', paddingTop: 28, borderTop: '1px solid #1A1D25' }}>
          {stat('Trades', String(d.trades))}
          {stat('Coins', String(d.coins))}
          {stat('Win rate', d.winRatePct != null ? `${Math.round(d.winRatePct)}%` : '—')}
          {stat('Best coin', d.best ? `$${d.best.symbol} ${d.best.pct != null ? pctText(d.best.pct) : ''}` : '—', !!d.best)}
        </div>
        <span style={{ fontFamily: 'GeistMono', fontSize: 20, color: '#2FE39A', marginTop: 22 }}>{SITE.replace(/^https?:\/\//, '')}/r/{d.handle} · 10% off fees</span>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'GeistMono', data: mono, weight: 600 },
        { name: 'GeistSemi', data: sans, weight: 600 },
        { name: 'Geist', data: sansReg, weight: 400 },
      ],
      headers: { 'cache-control': 'public, max-age=300, s-maxage=300' },
    },
  );
}

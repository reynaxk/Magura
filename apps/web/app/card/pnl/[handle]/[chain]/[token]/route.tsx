import { ImageResponse } from 'next/og';
import { heldFor, pctText, usdText, type PnlCardData } from '@/lib/pnl-card';

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

/** 1200×630 PnL card — the image people post. Includes the trader's invite link. */
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string; chain: string; token: string }> }) {
  const { handle, chain, token } = await params;
  const [mono, sans, sansReg, res] = await Promise.all([
    fetch(new URL('../../../../../../assets/fonts/GeistMono-SemiBold.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('../../../../../../assets/fonts/Geist-SemiBold.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('../../../../../../assets/fonts/Geist-Regular.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(`${API}/v1/cards/pnl/${encodeURIComponent(handle)}/${chain}/${encodeURIComponent(token)}`, { cache: 'no-store' }),
  ]);
  if (!res.ok) return new Response('Not found', { status: 404 });
  const d = (await res.json()) as PnlCardData;
  const up = d.pnlUsd >= 0;
  const accent = up ? '#2FE39A' : '#FF6B6B';
  const invite = `${SITE.replace(/^https?:\/\//, '')}/r/${d.handle}`;
  const stat = (k: string, v: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontFamily: 'Geist', fontSize: 20, color: '#8A93A6' }}>{k}</span>
      <span style={{ fontFamily: 'GeistMono', fontSize: 30, color: '#E9ECF2' }}>{v}</span>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#08090C', padding: 64, position: 'relative', fontFamily: 'Geist' }}>
        <div style={{ position: 'absolute', right: -120, top: -140, display: 'flex', opacity: 0.06 }}>{LOGO(620)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {LOGO(44)}
          <span style={{ fontFamily: 'GeistSemi', fontSize: 26, letterSpacing: 5, color: '#E9ECF2' }}>MAGURA</span>
        </div>

        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontFamily: 'GeistSemi', fontSize: 44, color: '#E9ECF2' }}>
              ${d.symbol}
              <span style={{ fontFamily: 'Geist', fontSize: 24, color: '#8A93A6', marginLeft: 16, marginTop: 16 }}>
                {d.chain === 'bsc' ? 'BNB' : d.chain[0].toUpperCase() + d.chain.slice(1)} · {d.holding ? 'holding' : 'closed'} · {heldFor(d.heldMs)}
              </span>
            </span>
            <span style={{ fontFamily: 'GeistMono', fontSize: 150, lineHeight: 1, letterSpacing: -6, color: accent }}>{pctText(d.pnlPct)}</span>
            <span style={{ fontFamily: 'GeistMono', fontSize: 40, color: '#E9ECF2' }}>{(up ? '+' : '') + usdText(d.pnlUsd)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26, paddingLeft: 40, borderLeft: '1px solid #1F232B' }}>
            {stat('Invested', usdText(d.investedUsd))}
            {stat(d.holding ? 'Value now' : 'Returned', usdText(d.returnedUsd + d.openValueUsd))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderTop: '1px solid #1A1D25', paddingTop: 26 }}>
          {d.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.avatarUrl} width={52} height={52} style={{ borderRadius: 14 }} alt="" />
          ) : (
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#1F232B', color: '#C9CFDA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'GeistSemi', fontSize: 20 }}>
              {d.handle.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: 'GeistSemi', fontSize: 24, color: '#E9ECF2' }}>@{d.handle}</span>
            <span style={{ fontFamily: 'GeistMono', fontSize: 20, color: '#2FE39A' }}>{invite} · 10% off fees</span>
          </div>
        </div>
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
      headers: { 'cache-control': 'public, max-age=60, s-maxage=60' },
    },
  );
}

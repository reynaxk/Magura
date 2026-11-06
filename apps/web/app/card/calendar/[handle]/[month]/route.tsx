import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magura.app';

interface CalendarData {
  handle: string;
  month: string;
  days: Record<string, number>;
  totalUsd: number;
  greenDays: number;
  redDays: number;
  currentStreak: number;
  bestStreak: number;
}

const usd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `$${(a / 1e3).toFixed(0)}K` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`;
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}${s}`;
};

/** 1200×630 PnL calendar card: every day of the month, green and red, plus streaks. */
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string; month: string }> }) {
  const { handle, month } = await params;
  const [mono, sans, res] = await Promise.all([
    fetch(new URL('../../../../../assets/fonts/GeistMono-SemiBold.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('../../../../../assets/fonts/Geist-SemiBold.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(`${API}/v1/cards/calendar/${encodeURIComponent(handle)}/${month}`, { cache: 'no-store' }),
  ]);
  if (!res.ok) return new Response('Not found', { status: 404 });
  const d = (await res.json()) as CalendarData;
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const label = first.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const max = Math.max(1, ...Object.values(d.days).map(Math.abs));
  const up = d.totalUsd >= 0;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#08090C', padding: 48, gap: 44 }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 340 }}>
          <span style={{ fontFamily: 'Semi', fontSize: 24, letterSpacing: 5, color: '#E9ECF2' }}>MAGURA</span>
          <span style={{ fontFamily: 'Semi', fontSize: 30, color: '#8A93A6', marginTop: 34 }}>@{d.handle}</span>
          <span style={{ fontFamily: 'Semi', fontSize: 30, color: '#E9ECF2', marginTop: 4 }}>{label}</span>
          <span style={{ fontFamily: 'Mono', fontSize: 84, lineHeight: 1, letterSpacing: -4, marginTop: 26, color: up ? '#2FE39A' : '#FF6B6B' }}>{usd(d.totalUsd)}</span>
          <span style={{ fontFamily: 'Semi', fontSize: 20, color: '#8A93A6', marginTop: 8 }}>realized this month</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 'auto' }}>
            {[
              ['Green days', String(d.greenDays)],
              ['Current streak', `${d.currentStreak} 🔥`],
              ['Best streak', String(d.bestStreak)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #1A1D25', paddingTop: 10 }}>
                <span style={{ fontFamily: 'Semi', fontSize: 20, color: '#8A93A6' }}>{k}</span>
                <span style={{ fontFamily: 'Mono', fontSize: 22, color: '#E9ECF2' }}>{v}</span>
              </div>
            ))}
            <span style={{ fontFamily: 'Mono', fontSize: 18, color: '#2FE39A', marginTop: 6 }}>{SITE.replace(/^https?:\/\//, '')}/r/{d.handle}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
              <span key={i} style={{ flex: 1, textAlign: 'center', fontFamily: 'Semi', fontSize: 16, color: '#59607A' }}>
                {w}
              </span>
            ))}
          </div>
          {Array.from({ length: cells.length / 7 }, (_, r) => (
            <div key={r} style={{ display: 'flex', gap: 8, flex: 1 }}>
              {cells.slice(r * 7, r * 7 + 7).map((day, i) => {
                const key = day ? `${month}-${String(day).padStart(2, '0')}` : '';
                const v = day ? d.days[key] : undefined;
                const a = v != null ? 0.18 + 0.62 * (Math.abs(v) / max) : 0;
                const bg = v == null ? '#0F1116' : v >= 0 ? `rgba(47,227,154,${a})` : `rgba(255,107,107,${a})`;
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 8, borderRadius: 12, background: day ? bg : 'transparent', border: day ? '1px solid #171A22' : 'none' }}>
                    <span style={{ fontFamily: 'Semi', fontSize: 14, color: '#8A93A6' }}>{day ?? ''}</span>
                    <span style={{ fontFamily: 'Mono', fontSize: 15, color: '#F2F4F3' }}>{v != null ? usd(v) : ''}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Mono', data: mono, weight: 600 },
        { name: 'Semi', data: sans, weight: 600 },
      ],
      headers: { 'cache-control': 'public, max-age=300, s-maxage=300' },
    },
  );
}

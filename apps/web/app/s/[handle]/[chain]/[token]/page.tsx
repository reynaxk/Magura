import type { Metadata } from 'next';
import Link from 'next/link';
import { pctText, SITE_URL, type PnlCardData } from '@/lib/pnl-card';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type P = { params: Promise<{ handle: string; chain: string; token: string }> };

async function load(p: Awaited<P['params']>): Promise<PnlCardData | null> {
  const r = await fetch(`${API}/v1/cards/pnl/${encodeURIComponent(p.handle)}/${p.chain}/${encodeURIComponent(p.token)}`, { cache: 'no-store' }).catch(() => null);
  return r?.ok ? ((await r.json()) as PnlCardData) : null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const p = await params;
  const d = await load(p);
  const img = `${SITE_URL}/card/pnl/${p.handle}/${p.chain}/${p.token}`;
  const title = d ? `@${d.handle} ${pctText(d.pnlPct)} on $${d.symbol}` : 'Magura';
  return {
    title,
    description: 'Trade together on Magura. Join with this link for 10% off trading fees.',
    openGraph: { title, images: [{ url: img, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, images: [img] },
  };
}

/** Public page behind a shared PnL card: the card, then the invite. */
export default async function SharedCard({ params }: P) {
  const p = await params;
  const d = await load(p);
  return (
    <div className="mx-auto flex max-w-[860px] flex-col items-center gap-6 p-4 py-10 md:p-10">
      {d ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/card/pnl/${p.handle}/${p.chain}/${p.token}`} alt={`@${d.handle} ${pctText(d.pnlPct)} on ${d.symbol}`} className="w-full rounded-2xl border border-line" />
      ) : (
        <p className="text-muted">This card isn&apos;t available.</p>
      )}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Trade with @{p.handle} on Magura</h1>
        <p className="text-sm text-muted">Spot trading with your people: copy the best, chat in every coin, call and stream.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href={`/r/${p.handle}`} className="btn-lime h-11 px-5">
          Join · 10% off fees
        </Link>
        <Link href={`/t/${p.chain}/${p.token}`} className="btn-ghost h-11 px-5">
          See ${d?.symbol ?? 'the coin'}
        </Link>
      </div>
    </div>
  );
}

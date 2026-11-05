import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_URL, usdText, type RecapData } from '@/lib/pnl-card';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type P = { params: Promise<{ handle: string; month: string }> };

async function load(handle: string, month: string): Promise<RecapData | null> {
  const r = await fetch(`${API}/v1/cards/recap/${encodeURIComponent(handle)}/${month}`, { cache: 'no-store' }).catch(() => null);
  return r?.ok ? ((await r.json()) as RecapData) : null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { handle, month } = await params;
  const d = await load(handle, month);
  const img = `${SITE_URL}/card/recap/${handle}/${month}`;
  const title = d ? `@${d.handle}'s ${d.label} on Magura: ${(d.realizedUsd >= 0 ? '+' : '') + usdText(d.realizedUsd)}` : 'Magura';
  return { title, openGraph: { title, images: [{ url: img, width: 1200, height: 630 }] }, twitter: { card: 'summary_large_image', title, images: [img] } };
}

export default async function SharedRecap({ params }: P) {
  const { handle, month } = await params;
  const d = await load(handle, month);
  return (
    <div className="mx-auto flex max-w-[860px] flex-col items-center gap-6 p-4 py-10 md:p-10">
      {d ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/card/recap/${handle}/${month}`} alt={`@${d.handle}'s ${d.label} on Magura`} className="w-full rounded-2xl border border-line" />
      ) : (
        <p className="text-muted">This recap isn&apos;t available.</p>
      )}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Trade with @{handle} on Magura</h1>
        <p className="text-sm text-muted">Join with this link and pay 10% less on every trade.</p>
      </div>
      <Link href={`/r/${handle}`} className="btn-lime h-11 px-5">
        Join · 10% off fees
      </Link>
    </div>
  );
}

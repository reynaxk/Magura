import { notFound } from 'next/navigation';
import { isChainId } from '@magura/shared';
import { Terminal } from '@/components/terminal';
import { CoinDrawer } from '@/components/coin-drawer';

/** Coin opened from a list: slides in over Hunt/Trenches so the list keeps its scroll and filters. */
export default async function CoinDrawerPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  if (!isChainId(chain)) notFound();
  const a = chain === 'solana' ? address : address.toLowerCase();
  return (
    <CoinDrawer href={`/t/${chain}/${a}`}>
      <Terminal chain={chain} address={a} inDrawer />
    </CoinDrawer>
  );
}

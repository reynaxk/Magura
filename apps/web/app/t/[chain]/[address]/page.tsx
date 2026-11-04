import { notFound } from 'next/navigation';
import { isChainId } from '@magura/shared';
import { Terminal } from '@/components/terminal';

export default async function TokenPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  if (!isChainId(chain)) notFound();
  return <Terminal chain={chain} address={chain === 'solana' ? address : address.toLowerCase()} />;
}

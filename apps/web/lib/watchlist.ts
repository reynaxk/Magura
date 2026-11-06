'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

export interface WatchRow {
  chain: string;
  address: string;
  token: { symbol: string; name: string; imageUrl: string | null; marketCapUsd: number | null; priceChange1h: number | null; priceChange24h: number | null; createdAt: string } | null;
}

/** Starred coins + a toggle. */
export function useWatchlist() {
  const { me, login } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['watchlist'], queryFn: () => api<WatchRow[]>('/me/watchlist'), enabled: !!me, refetchInterval: 30_000 });
  const set = new Set((q.data ?? []).map((r) => `${r.chain}:${r.address}`));
  const m = useMutation({
    mutationFn: ({ chain, address, on }: { chain: string; address: string; on: boolean }) => api(`/me/watchlist/${chain}/${address}`, { method: on ? 'POST' : 'DELETE' }),
    onMutate: async ({ chain, address, on }) => {
      qc.setQueryData<WatchRow[]>(['watchlist'], (xs = []) => (on ? [{ chain, address, token: null }, ...xs] : xs.filter((x) => !(x.chain === chain && x.address === address))));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['watchlist'] }),
  });
  return {
    rows: q.data ?? [],
    has: (chain: string, address: string) => set.has(`${chain}:${address}`),
    toggle: (chain: string, address: string) => (me ? m.mutate({ chain, address, on: !set.has(`${chain}:${address}`) }) : login()),
  };
}

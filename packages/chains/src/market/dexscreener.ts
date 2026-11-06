import { CHAINS, type ChainId, type PairSummary, isChainId } from '@magura/shared';
import { fetchJson, num } from '../http';

const BASE = 'https://api.dexscreener.com';

interface DsPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume?: { m5?: number; h1?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type?: string; url: string }[] };
  txns?: { m5?: { buys: number; sells: number }; h1?: { buys: number; sells: number }; h24?: { buys: number; sells: number } };
}

function toSummary(p: DsPair): PairSummary | null {
  const chain = Object.values(CHAINS).find((c) => c.dexscreener === p.chainId)?.id;
  if (!chain) return null;
  return {
    chain,
    pairAddress: p.pairAddress,
    dex: p.dexId,
    baseToken: p.baseToken,
    quoteToken: p.quoteToken,
    priceUsd: num(p.priceUsd),
    priceChange24h: num(p.priceChange?.h24),
    priceChange1h: num(p.priceChange?.h1),
    priceChange5m: num(p.priceChange?.m5),
    priceChange6h: num(p.priceChange?.h6),
    volume1h: num(p.volume?.h1),
    buys24h: p.txns?.h24?.buys ?? null,
    sells24h: p.txns?.h24?.sells ?? null,
    links: [...(p.info?.websites ?? []).map((w) => ({ type: 'website', url: w.url })), ...(p.info?.socials ?? []).map((x) => ({ type: x.type ?? 'link', url: x.url }))].slice(0, 6),
    volume24h: num(p.volume?.h24),
    volume5m: num(p.volume?.m5),
    buys5m: p.txns?.m5?.buys ?? null,
    sells5m: p.txns?.m5?.sells ?? null,
    socials: {
      x: !!p.info?.socials?.some((x) => x.type === 'twitter' || /x\.com|twitter\.com/.test(x.url)),
      telegram: !!p.info?.socials?.some((x) => x.type === 'telegram' || /t\.me/.test(x.url)),
      website: !!p.info?.websites?.length,
    },
    liquidityUsd: num(p.liquidity?.usd),
    fdv: num(p.fdv),
    marketCap: num(p.marketCap),
    pairCreatedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
    imageUrl: p.info?.imageUrl ?? null,
  };
}

export interface DexOrders {
  /** paid for a token profile / ad / boost on DexScreener */
  paid: boolean;
  cto: boolean;
  kinds: string[];
}

export const dexscreener = {
  /** Has the team paid DexScreener (profile, ads) and is it a community takeover? */
  async orders(chain: ChainId, address: string): Promise<DexOrders> {
    const rows = await fetchJson<{ type: string; status: string }[]>(`${BASE}/orders/v1/${CHAINS[chain].dexscreener}/${address}`, { retries: 0, timeoutMs: 5000 });
    const ok = (Array.isArray(rows) ? rows : []).filter((r) => r.status === 'approved');
    return { paid: ok.some((r) => r.type !== 'communityTakeover'), cto: ok.some((r) => r.type === 'communityTakeover'), kinds: [...new Set(ok.map((r) => r.type))] };
  },

  /** All pairs for up to 30 token addresses on one chain, best liquidity first. */
  async tokenPairs(chain: ChainId, addresses: string[]): Promise<PairSummary[]> {
    if (!addresses.length) return [];
    const slug = CHAINS[chain].dexscreener;
    const pairs = await fetchJson<DsPair[]>(`${BASE}/tokens/v1/${slug}/${addresses.slice(0, 30).join(',')}`);
    return pairs
      .map(toSummary)
      .filter((p): p is PairSummary => !!p)
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  },

  /** Best pair for a token (highest liquidity). */
  async bestPair(chain: ChainId, address: string): Promise<PairSummary | null> {
    const pairs = await this.tokenPairs(chain, [address]);
    return pairs[0] ?? null;
  },

  async pair(chain: ChainId, pairAddress: string): Promise<PairSummary | null> {
    const res = await fetchJson<{ pairs: DsPair[] | null }>(
      `${BASE}/latest/dex/pairs/${CHAINS[chain].dexscreener}/${pairAddress}`,
    );
    return res.pairs?.[0] ? toSummary(res.pairs[0]) : null;
  },

  async search(query: string): Promise<PairSummary[]> {
    const res = await fetchJson<{ pairs: DsPair[] | null }>(`${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`);
    return (res.pairs ?? [])
      .filter((p) => Object.values(CHAINS).some((c) => c.dexscreener === p.chainId))
      .map(toSummary)
      .filter((p): p is PairSummary => !!p);
  },

  /** Raw buy/sell counts for trenches cards. */
  async txCounts(chain: ChainId, address: string): Promise<{ buys: number; sells: number } | null> {
    const slug = CHAINS[chain].dexscreener;
    const pairs = await fetchJson<DsPair[]>(`${BASE}/tokens/v1/${slug}/${address}`);
    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return best?.txns?.h24 ?? null;
  },

  chainFromSlug(slug: string): ChainId | null {
    const c = Object.values(CHAINS).find((x) => x.dexscreener === slug)?.id;
    return c && isChainId(c) ? c : null;
  },
};

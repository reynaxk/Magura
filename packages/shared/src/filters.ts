import type { ChainId } from './chains';

/**
 * Coin filters shared by Hunt and every Trenches column.
 * The API applies them; the web Filters panel edits them.
 */

/** Where a coin launched or trades. Launchpads first, then DEXs. */
export const SOURCES = [
  { id: 'pumpfun', label: 'Pump.fun', color: '#5BE39A', chains: ['solana'] },
  { id: 'pumpswap', label: 'PumpSwap', color: '#4FD1C5', chains: ['solana'] },
  { id: 'raydium', label: 'Raydium', color: '#8B9CFF', chains: ['solana'] },
  { id: 'meteora', label: 'Meteora', color: '#F5A64A', chains: ['solana'] },
  { id: 'orca', label: 'Orca', color: '#F2D15C', chains: ['solana'] },
  { id: 'fourmeme', label: 'Four.meme', color: '#F5B94A', chains: ['bsc'] },
  { id: 'flap', label: 'Flap', color: '#D9F27A', chains: ['bsc'] },
  { id: 'pons', label: 'Pons', color: '#E6F25A', chains: ['bsc'] },
  { id: 'pancakeswap', label: 'PancakeSwap', color: '#5EC8E6', chains: ['bsc', 'base', 'ethereum'] },
  { id: 'clanker', label: 'Clanker', color: '#A78BFA', chains: ['base'] },
  { id: 'aerodrome', label: 'Aerodrome', color: '#5B8CFF', chains: ['base'] },
  { id: 'uniswap', label: 'Uniswap', color: '#F472B6', chains: ['base', 'ethereum', 'bsc'] },
] as const satisfies readonly { id: string; label: string; color: string; chains: readonly ChainId[] }[];

export type SourceId = (typeof SOURCES)[number]['id'];

/** Map a raw DexScreener/GeckoTerminal dex id or launchpad id to a filter source. */
export function sourceOf(launchpad: string | null, dex: string | null): SourceId | null {
  const raw = (launchpad ?? dex ?? '').toLowerCase();
  if (!raw) return null;
  if (raw.includes('pumpswap') || raw === 'pump-amm') return 'pumpswap';
  if (raw.includes('pump')) return 'pumpfun';
  if (raw.includes('raydium')) return 'raydium';
  if (raw.includes('meteora')) return 'meteora';
  if (raw.includes('orca')) return 'orca';
  if (raw.includes('four')) return 'fourmeme';
  if (raw.includes('flap')) return 'flap';
  if (raw.includes('pons')) return 'pons';
  if (raw.includes('pancake')) return 'pancakeswap';
  if (raw.includes('clanker')) return 'clanker';
  if (raw.includes('aerodrome')) return 'aerodrome';
  if (raw.includes('uniswap')) return 'uniswap';
  return null;
}

export type Range = { min?: number; max?: number };

export const RANGE_FIELDS = [
  { key: 'bonding', label: 'Bonding curve', unit: '%' },
  { key: 'ageMin', label: 'Age', unit: 'min' },
  { key: 'liquidity', label: 'Liquidity', unit: '$' },
  { key: 'marketCap', label: 'Market cap', unit: '$' },
  { key: 'volume5m', label: 'Volume 5m', unit: '$' },
  { key: 'netBuys5m', label: 'Net buys 5m', unit: '' },
  { key: 'holders', label: 'Holders', unit: '' },
  { key: 'buys5m', label: 'Buys 5m', unit: '' },
  { key: 'sells5m', label: 'Sells 5m', unit: '' },
  { key: 'top10', label: 'Top 10 holding', unit: '%' },
  { key: 'dev', label: 'Dev holding', unit: '%' },
  { key: 'snipers', label: 'Snipers', unit: '%' },
  { key: 'change1h', label: 'Price change 1h', unit: '%' },
  { key: 'chat', label: 'Room messages', unit: '' },
] as const;

export type RangeKey = (typeof RANGE_FIELDS)[number]['key'];

export interface CoinFilter {
  chains: ChainId[];
  /** empty = every source */
  sources: SourceId[];
  hasX: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  devUnder20: boolean;
  excludeMintable: boolean;
  excludeFreezable: boolean;
  auditedOnly: boolean;
  friendsBought: boolean;
  ranges: Partial<Record<RangeKey, Range>>;
}

export const EMPTY_FILTER: CoinFilter = {
  chains: ['solana', 'base', 'bsc', 'ethereum'],
  sources: [],
  hasX: false,
  hasTelegram: false,
  hasWebsite: false,
  devUnder20: false,
  excludeMintable: false,
  excludeFreezable: false,
  auditedOnly: false,
  friendsBought: false,
  ranges: {},
};

/** Number of active filter rules (for the badge on the Filters button). */
export function activeFilterCount(f: CoinFilter): number {
  let n = 0;
  if (f.chains.length < 4) n++;
  if (f.sources.length) n++;
  for (const k of ['hasX', 'hasTelegram', 'hasWebsite', 'devUnder20', 'excludeMintable', 'excludeFreezable', 'auditedOnly', 'friendsBought'] as const) if (f[k]) n++;
  for (const r of Object.values(f.ranges)) if (r && (r.min != null || r.max != null)) n++;
  return n;
}

/** The facts about one coin that filters look at. */
export interface FilterFacts {
  chain: ChainId;
  source: SourceId | null;
  bonding: number | null;
  ageMin: number;
  liquidity: number | null;
  marketCap: number | null;
  volume5m: number | null;
  buys5m: number | null;
  sells5m: number | null;
  holders: number | null;
  top10: number | null;
  dev: number | null;
  snipers: number | null;
  change1h: number | null;
  chat: number;
  hasX: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  mintable: boolean | null;
  freezable: boolean | null;
  audited: boolean;
  friendsBought: boolean;
}

/**
 * Does a coin pass the filter? Unknown values fail a bound that was set,
 * so "Holders min 100" never shows coins whose holder count we don't know.
 */
export function matchesFilter(c: FilterFacts, f: CoinFilter): boolean {
  if (!f.chains.includes(c.chain)) return false;
  if (f.sources.length && (!c.source || !f.sources.includes(c.source))) return false;
  if (f.hasX && !c.hasX) return false;
  if (f.hasTelegram && !c.hasTelegram) return false;
  if (f.hasWebsite && !c.hasWebsite) return false;
  if (f.devUnder20 && !(c.dev != null && c.dev < 20)) return false;
  if (f.excludeMintable && c.mintable !== false) return false;
  if (f.excludeFreezable && c.freezable === true) return false;
  if (f.auditedOnly && !c.audited) return false;
  if (f.friendsBought && !c.friendsBought) return false;
  const value: Record<RangeKey, number | null> = {
    bonding: c.bonding,
    ageMin: c.ageMin,
    liquidity: c.liquidity,
    marketCap: c.marketCap,
    volume5m: c.volume5m,
    netBuys5m: c.buys5m != null && c.sells5m != null ? c.buys5m - c.sells5m : null,
    holders: c.holders,
    buys5m: c.buys5m,
    sells5m: c.sells5m,
    top10: c.top10,
    dev: c.dev,
    snipers: c.snipers,
    change1h: c.change1h,
    chat: c.chat,
  };
  for (const [k, r] of Object.entries(f.ranges) as [RangeKey, Range | undefined][]) {
    if (!r || (r.min == null && r.max == null)) continue;
    const v = value[k];
    if (v == null) return false;
    if (r.min != null && v < r.min) return false;
    if (r.max != null && v > r.max) return false;
  }
  return true;
}

/** Parse a filter from a query param (JSON), falling back to defaults on bad input. */
export function parseFilter(raw: string | undefined | null): CoinFilter {
  if (!raw) return EMPTY_FILTER;
  try {
    const v = JSON.parse(raw) as Partial<CoinFilter>;
    return { ...EMPTY_FILTER, ...v, ranges: { ...(v.ranges ?? {}) } };
  } catch {
    return EMPTY_FILTER;
  }
}

import { CHAINS, type Candle, type ChainId, type Timeframe } from '@magura/shared';
import { fetchJson, HttpError, num } from '../http';

const BASE = 'https://api.geckoterminal.com/api/v2';

/**
 * GeckoTerminal's free API allows ~30 calls/min per IP. Keep a per-process budget so we never trip it
 * (a 429 burns the whole minute), and fail fast instead of retrying into the limit.
 */
const PER_MIN = Number(process.env.GECKOTERMINAL_PER_MIN ?? 28);
const bucket = { tokens: PER_MIN, at: Date.now() };
function take(reserve = 0): void {
  const now = Date.now();
  bucket.tokens = Math.min(PER_MIN, bucket.tokens + ((now - bucket.at) / 60_000) * PER_MIN);
  bucket.at = now;
  if (bucket.tokens < 1 + reserve) throw new HttpError(429, BASE, 'local_rate_budget');
  bucket.tokens -= 1;
}
const HEADERS = { accept: 'application/json;version=20230302' };

const TF: Record<Timeframe, { period: 'minute' | 'hour' | 'day'; aggregate: number }> = {
  '1m': { period: 'minute', aggregate: 1 },
  '5m': { period: 'minute', aggregate: 5 },
  '15m': { period: 'minute', aggregate: 15 },
  '1h': { period: 'hour', aggregate: 1 },
  '4h': { period: 'hour', aggregate: 4 },
  '1d': { period: 'day', aggregate: 1 },
};

export interface NewPool {
  chain: ChainId;
  poolAddress: string;
  baseTokenAddress: string;
  name: string;
  createdAt: string;
  priceUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  buys24h: number | null;
  sells24h: number | null;
  dex: string | null;
}

export interface PoolTrade {
  side: 'buy' | 'sell';
  wallet: string;
  usd: number | null;
  /** Token price in USD at the moment of the trade. */
  priceUsd: number | null;
  /** Native-coin amount on the native side of the swap, when the pool quotes against it. */
  tokenAmount: number | null;
  txHash: string;
  at: string;
}

export const geckoterminal = {
  /** Last ~300 swaps on a pool, newest first. */
  async trades(chain: ChainId, pool: string, minUsd = 0): Promise<PoolTrade[]> {
    const net = CHAINS[chain].geckoterminal;
    take(4);
    const res = await fetchJson<{ data: any[] }>(
      `${BASE}/networks/${net}/pools/${pool}/trades${minUsd > 0 ? `?trade_volume_in_usd_greater_than=${minUsd}` : ''}`,
      { headers: HEADERS, retries: 0 },
    );
    return res.data.map((d) => {
      const a = d.attributes;
      const buy = a.kind === 'buy';
      return {
        side: buy ? 'buy' : 'sell',
        wallet: a.tx_from_address,
        usd: num(a.volume_in_usd),
        priceUsd: num(buy ? a.price_to_in_usd : a.price_from_in_usd),
        tokenAmount: num(buy ? a.to_token_amount : a.from_token_amount),
        txHash: a.tx_hash,
        at: a.block_timestamp,
      } as PoolTrade;
    });
  },

  async ohlcv(chain: ChainId, pool: string, tf: Timeframe, limit = 300): Promise<Candle[]> {
    const { period, aggregate } = TF[tf];
    const net = CHAINS[chain].geckoterminal;
    take();
    const res = await fetchJson<{ data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } }>(
      `${BASE}/networks/${net}/pools/${pool}/ohlcv/${period}?aggregate=${aggregate}&limit=${limit}&currency=usd`,
      { headers: HEADERS, retries: 0 },
    );
    return res.data.attributes.ohlcv_list
      .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
      .sort((a, b) => a.t - b.t);
  },

  /** Newest DEX pools on a chain — feeds "Survived" (migrated) and EVM chains without a launchpad. */
  async newPools(chain: ChainId, page = 1): Promise<NewPool[]> {
    const net = CHAINS[chain].geckoterminal;
    take(10); // background job: always leave room for people looking at charts
    const res = await fetchJson<{ data: any[] }>(`${BASE}/networks/${net}/new_pools?page=${page}&include=dex`, { headers: HEADERS, retries: 0 });
    return res.data.map((d) => {
      const a = d.attributes;
      const baseId: string = d.relationships?.base_token?.data?.id ?? '';
      return {
        chain,
        poolAddress: a.address,
        baseTokenAddress: baseId.split('_').slice(1).join('_'),
        name: a.name,
        createdAt: a.pool_created_at,
        priceUsd: num(a.base_token_price_usd),
        fdvUsd: num(a.fdv_usd),
        marketCapUsd: num(a.market_cap_usd),
        volume24h: num(a.volume_usd?.h24),
        liquidityUsd: num(a.reserve_in_usd),
        buys24h: num(a.transactions?.h24?.buys),
        sells24h: num(a.transactions?.h24?.sells),
        dex: d.relationships?.dex?.data?.id ?? null,
      };
    });
  },
};

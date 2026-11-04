import { fetchJson, num } from '../http';
import type { LaunchEvent, LaunchpadFeed } from './types';

/**
 * Clanker (Base). Polls the public Clanker API for newly deployed tokens.
 * Clanker tokens launch straight into a Uniswap v3/v4 pool, so they enter as
 * "new" and graduate to "survived" by age/market cap in the trenches worker.
 */
const API = 'https://www.clanker.world/api/tokens';

interface ClankerToken {
  contract_address: string;
  name: string;
  symbol: string;
  img_url?: string | null;
  deployed_at?: string;
  created_at?: string;
  pool_address?: string;
  requestor_fid?: number;
  starting_market_cap?: number;
}

export class ClankerFeed implements LaunchpadFeed {
  readonly id = 'clanker' as const;
  readonly chain = 'base' as const;
  private timer: NodeJS.Timeout | null = null;
  private seen = new Set<string>();

  constructor(private readonly intervalMs = 5000) {}

  async start(onEvent: (e: LaunchEvent) => void) {
    const poll = async () => {
      try {
        const res = await fetchJson<{ data: ClankerToken[] }>(`${API}?sort=desc&page=1`, { retries: 0 });
        for (const t of [...res.data].reverse()) {
          const addr = t.contract_address?.toLowerCase();
          if (!addr || this.seen.has(addr)) continue;
          this.seen.add(addr);
          onEvent({
            type: 'created',
            chain: 'base',
            launchpad: 'clanker',
            address: addr,
            symbol: t.symbol,
            name: t.name,
            imageUrl: t.img_url ?? null,
            marketCapUsd: num(t.starting_market_cap),
            bondingPct: null,
            pairAddress: t.pool_address,
            at: new Date(t.deployed_at ?? t.created_at ?? Date.now()),
          });
        }
        if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
      } catch {
        /* transient — next tick */
      }
    };
    await poll();
    this.timer = setInterval(poll, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

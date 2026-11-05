import { CHAINS, type ChainId, type TokenRisk } from '@magura/shared';
import { fetchJson, num } from '../http';

const BASE = 'https://api.gopluslabs.io/api/v1';

const pct = (v: unknown) => {
  const n = num(v);
  return n == null ? null : n * 100;
};
const flag = (v: unknown) => (v == null || v === '' ? null : String(v) === '1');

export interface TopHolder {
  address: string;
  pct: number;
  tag: string | null;
  isContract: boolean;
  isLocked: boolean;
}

/** Token security + holder concentration from GoPlus. */
export const goplus = {
  /** Top holders (GoPlus returns up to ~10–20) plus the creator address. */
  async topHolders(chain: ChainId, address: string): Promise<{ creator: string | null; holders: TopHolder[] }> {
    const headers: Record<string, string> = process.env.GOPLUS_ACCESS_TOKEN ? { Authorization: process.env.GOPLUS_ACCESS_TOKEN } : {};
    const url = chain === 'solana' ? `${BASE}/solana/token_security?contract_addresses=${address}` : `${BASE}/token_security/${CHAINS[chain].goplus}?contract_addresses=${address}`;
    const res = await fetchJson<{ result: Record<string, any> }>(url, { headers });
    const r = res.result?.[chain === 'solana' ? address : address.toLowerCase()];
    if (!r) return { creator: null, holders: [] };
    const creator: string | null = chain === 'solana' ? (r.creators?.[0]?.address ?? null) : (r.creator_address ?? null);
    const holders: TopHolder[] = (r.holders ?? []).map((h: any) => ({
      address: h.account ?? h.address,
      pct: Number(h.percent) * 100,
      tag: h.tag || null,
      isContract: String(h.is_contract) === '1',
      isLocked: String(h.is_locked) === '1',
    }));
    return { creator, holders };
  },

  async tokenRisk(chain: ChainId, address: string): Promise<TokenRisk | null> {
    const headers: Record<string, string> = process.env.GOPLUS_ACCESS_TOKEN
      ? { Authorization: process.env.GOPLUS_ACCESS_TOKEN }
      : {};
    if (chain === 'solana') {
      const res = await fetchJson<{ result: Record<string, any> }>(
        `${BASE}/solana/token_security?contract_addresses=${address}`,
        { headers },
      );
      const r = res.result?.[address];
      if (!r) return null;
      const holders: { percent: string }[] = r.holders ?? [];
      return {
        top10Pct: holders.length ? holders.slice(0, 10).reduce((s, h) => s + Number(h.percent) * 100, 0) : null,
        devPct: pct(r.creators?.[0]?.percent),
        sniperPct: null,
        honeypot: null,
        mintable: r.mintable ? r.mintable.status === '1' : null,
        freezable: r.freezable ? r.freezable.status === '1' : null,
        buyTax: null,
        sellTax: null,
        holders: num(r.holder_count),
      };
    }
    const id = CHAINS[chain].goplus;
    const res = await fetchJson<{ result: Record<string, any> }>(
      `${BASE}/token_security/${id}?contract_addresses=${address}`,
      { headers },
    );
    const r = res.result?.[address.toLowerCase()];
    if (!r) return null;
    const holders: { percent: string; is_contract?: number }[] = r.holders ?? [];
    return {
      top10Pct: holders.length ? holders.slice(0, 10).reduce((s, h) => s + Number(h.percent) * 100, 0) : null,
      devPct: pct(r.creator_percent),
      sniperPct: null,
      honeypot: flag(r.is_honeypot),
      mintable: flag(r.is_mintable),
      freezable: null,
      buyTax: pct(r.buy_tax),
      sellTax: pct(r.sell_tax),
      holders: num(r.holder_count),
    };
  },
};

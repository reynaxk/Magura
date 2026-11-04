import { CHAINS, type ChainId, type TokenRisk } from '@magura/shared';
import { fetchJson, num } from '../http';

const BASE = 'https://api.gopluslabs.io/api/v1';

const pct = (v: unknown) => {
  const n = num(v);
  return n == null ? null : n * 100;
};
const flag = (v: unknown) => (v == null || v === '' ? null : String(v) === '1');

/** Token security + holder concentration from GoPlus. */
export const goplus = {
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
    };
  },
};

import { fetchJson, num } from '../http';

/** Spot prices for majors (SOL, ETH, BNB, BTC) used for header ticker and USD conversion. */
export const coinbase = {
  async spot(symbol: string): Promise<number | null> {
    const res = await fetchJson<{ data: { amount: string } }>(
      `https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol)}-USD/spot`,
    );
    return num(res.data.amount);
  },

  async many(symbols: string[]): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    await Promise.all(
      symbols.map(async (s) => {
        try {
          out[s] = await this.spot(s);
        } catch {
          out[s] = null;
        }
      }),
    );
    return out;
  },
};

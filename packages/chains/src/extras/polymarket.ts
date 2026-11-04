import { fetchJson, num } from '../http';

/** Polymarket (Gamma API) — prediction questions shown next to coin rooms. */
export const polymarket = {
  async markets(query: string, limit = 5) {
    const res = await fetchJson<any[]>(
      `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${limit}&order=volume24hr&ascending=false&tag_slug=crypto${
        query ? `&slug_contains=${encodeURIComponent(query.toLowerCase())}` : ''
      }`,
    );
    return res.map((m) => ({
      id: String(m.id),
      question: m.question as string,
      url: `https://polymarket.com/event/${m.slug}`,
      yesPrice: num(JSON.parse(m.outcomePrices ?? '[]')[0]),
      volume24h: num(m.volume24hr),
      endDate: m.endDate as string | null,
    }));
  },
};

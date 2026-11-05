import type { Token } from '@magura/db';
import { sourceOf, type ChainId, type FilterFacts, type TokenRisk } from '@magura/shared';

/** Turn a stored token into the facts the Filters panel can test. */
export function factsFor(t: Token, chat: number, friendsBought: boolean): FilterFacts {
  const risk = (t.risk as TokenRisk | null) ?? null;
  return {
    chain: t.chain as ChainId,
    source: sourceOf(t.launchpad, t.dex),
    bonding: t.migratedAt ? 100 : t.bondingPct,
    ageMin: (Date.now() - t.createdAt.getTime()) / 60_000,
    liquidity: t.liquidityUsd,
    marketCap: t.marketCapUsd,
    volume5m: t.volume5m,
    buys5m: t.buys5m,
    sells5m: t.sells5m,
    holders: t.holders ?? risk?.holders ?? null,
    top10: risk?.top10Pct ?? null,
    dev: risk?.devPct ?? null,
    snipers: risk?.sniperPct ?? null,
    change1h: t.priceChange1h,
    chat,
    hasX: t.hasX,
    hasTelegram: t.hasTelegram,
    hasWebsite: t.hasWebsite,
    mintable: risk?.mintable ?? null,
    freezable: risk?.freezable ?? null,
    audited: !!risk && !!t.riskCheckedAt,
    friendsBought,
  };
}

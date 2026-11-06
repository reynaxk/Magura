import type { Token } from '@magura/db';
import { sourceOf, type ChainId, type FilterFacts, type TokenIntel, type TokenRisk } from '@magura/shared';

export interface DevStats {
  launched: number;
  migratedPct: number;
}

/** Turn a stored token into the facts the Filters panel can test. */
export function factsFor(t: Token, chat: number, friendsBought: boolean, friends = 0, dev?: DevStats | null): FilterFacts {
  const risk = (t.risk as TokenRisk | null) ?? null;
  const intel = (t.intel as TokenIntel | null) ?? null;
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
    holders: t.holders ?? intel?.holders ?? risk?.holders ?? null,
    // our own ledger wins for launchpad coins; GoPlus covers the rest
    top10: intel?.top10Pct ?? risk?.top10Pct ?? null,
    dev: intel?.devPct ?? risk?.devPct ?? null,
    snipers: intel?.sniperPct ?? risk?.sniperPct ?? null,
    bundlers: intel?.bundlerPct ?? null,
    insiders: intel?.insiderPct ?? null,
    fresh: intel?.freshPct ?? null,
    earlyHold: intel?.earlyHoldPct ?? null,
    athMc: t.athMarketCapUsd,
    devLaunched: dev?.launched ?? null,
    devMigratedPct: dev?.migratedPct ?? null,
    friends,
    devSoldAll: intel ? intel.devSoldAll : null,
    devHolds: intel ? intel.devHolds : null,
    name: t.name,
    symbol: t.symbol,
    creator: t.creator,
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

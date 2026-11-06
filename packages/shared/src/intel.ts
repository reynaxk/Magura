/**
 * Holder intelligence: who holds a coin and how they got it.
 *
 * Built from the launchpad trade stream (every buy/sell from the moment a coin launches),
 * so for launchpad coins we know each wallet's entry time, cost and current balance.
 * Everything here is pure so the API worker, tests and the web app share one definition.
 */

export const WALLET_TAGS = [
  { id: 'dev', label: 'Dev', short: 'DEV', color: '#F5A64A', hint: 'Created the coin' },
  { id: 'bundler', label: 'Bundler', short: 'BND', color: '#FF5C7A', hint: 'Bought in the same block as the launch' },
  { id: 'sniper', label: 'Sniper', short: 'SNP', color: '#F2D15C', hint: 'Bought within seconds of launch' },
  { id: 'insider', label: 'Insider', short: 'INS', color: '#E879F9', hint: 'Brand-new wallet that bought at launch' },
  { id: 'fresh', label: 'Fresh', short: 'FRS', color: '#5EC8E6', hint: 'Wallet with almost no history' },
  { id: 'early', label: 'Early', short: 'ERL', color: '#8B9CFF', hint: 'One of the first 70 buyers' },
  { id: 'whale', label: 'Whale', short: 'WHL', color: '#4FD1C5', hint: 'Holds 2%+ of supply' },
  { id: 'smart', label: 'Smart', short: 'SMT', color: '#2FE39A', hint: 'Consistently profitable trader' },
  { id: 'kol', label: 'KOL', short: 'KOL', color: '#A78BFA', hint: 'Known caller' },
  { id: 'magura', label: 'Magura', short: 'MGR', color: '#2FE39A', hint: 'Trades on Magura' },
] as const;

export type WalletTag = (typeof WALLET_TAGS)[number]['id'];
export const tagMeta = (id: WalletTag) => WALLET_TAGS.find((t) => t.id === id)!;

/** Timing windows (ms after launch). Same-block on Solana ≈ 400ms; we allow for feed jitter. */
export const BUNDLE_WINDOW_MS = 1_200;
export const SNIPE_WINDOW_MS = 5_000;
export const EARLY_BUYERS = 70;
export const WHALE_PCT = 2;

/** One wallet's position in one coin, as recorded from the trade stream. */
export interface LedgerEntry {
  /** token balance now */
  bal: number;
  /** tokens bought / sold */
  bt: number;
  st: number;
  /** native coin spent / received */
  ni: number;
  no: number;
  buys: number;
  sells: number;
  /** ms after launch of the first buy (null if they never bought, e.g. transfer-in) */
  first: number | null;
  /** buy rank (1 = first buyer after dev) */
  rank: number | null;
  last: number;
  fresh?: boolean;
}

export interface LedgerTrade {
  wallet: string;
  side: 'buy' | 'sell';
  tokenAmount: number;
  nativeAmount: number;
  balanceAfter?: number | null;
}

/** Apply one trade to a wallet entry. `msSinceLaunch` drives sniper/bundle tags; `buyRank` is the running buyer count. */
export function applyTrade(prev: LedgerEntry | null, t: LedgerTrade, msSinceLaunch: number, buyRank: number): LedgerEntry {
  const e: LedgerEntry = prev ? { ...prev } : { bal: 0, bt: 0, st: 0, ni: 0, no: 0, buys: 0, sells: 0, first: null, rank: null, last: 0 };
  if (t.side === 'buy') {
    e.bt += t.tokenAmount;
    e.ni += t.nativeAmount;
    e.buys += 1;
    if (e.first == null) {
      e.first = Math.max(0, msSinceLaunch);
      e.rank = buyRank;
    }
  } else {
    e.st += t.tokenAmount;
    e.no += t.nativeAmount;
    e.sells += 1;
  }
  e.bal = t.balanceAfter != null && Number.isFinite(t.balanceAfter) ? Math.max(0, t.balanceAfter) : Math.max(0, e.bal + (t.side === 'buy' ? t.tokenAmount : -t.tokenAmount));
  e.last = Math.max(0, msSinceLaunch);
  return e;
}

/** Tags for one wallet. */
export function tagsFor(wallet: string, e: LedgerEntry, creator: string | null, supply: number | null): WalletTag[] {
  const tags: WalletTag[] = [];
  const isDev = !!creator && wallet === creator;
  if (isDev) tags.push('dev');
  if (!isDev && e.first != null) {
    if (e.first <= BUNDLE_WINDOW_MS) tags.push('bundler');
    else if (e.first <= SNIPE_WINDOW_MS) tags.push('sniper');
    if (e.fresh && e.first <= SNIPE_WINDOW_MS * 6) tags.push('insider');
    if (e.rank != null && e.rank <= EARLY_BUYERS) tags.push('early');
  }
  if (e.fresh) tags.push('fresh');
  if (supply && (e.bal / supply) * 100 >= WHALE_PCT && !isDev) tags.push('whale');
  return tags;
}

/** Supply split + headline stats shown on cards, filters and the coin page. */
export interface TokenIntel {
  holders: number;
  /** % of total supply */
  top10Pct: number | null;
  devPct: number | null;
  sniperPct: number | null;
  bundlerPct: number | null;
  insiderPct: number | null;
  freshPct: number | null;
  /** % of supply still held by the first 70 buyers */
  earlyHoldPct: number | null;
  /** counts */
  snipers: number;
  bundlers: number;
  insiders: number;
  fresh: number;
  /** dev behaviour */
  devHolds: boolean;
  devSoldAll: boolean;
  devSoldPct: number;
  /** native flows (SOL/BNB) since launch */
  buyVolNative: number;
  sellVolNative: number;
  updatedAt: number;
}

export function computeIntel(ledger: Record<string, LedgerEntry>, creator: string | null, supply: number | null): TokenIntel {
  const pct = (x: number) => (supply ? Math.round((x / supply) * 10_000) / 100 : null);
  let holders = 0;
  let dev = 0;
  let devBought = 0;
  let devSold = 0;
  let sn = 0,
    bn = 0,
    ins = 0,
    fr = 0,
    early = 0;
  let snC = 0,
    bnC = 0,
    insC = 0,
    frC = 0;
  let buyVol = 0,
    sellVol = 0;
  const balances: number[] = [];
  for (const [w, e] of Object.entries(ledger)) {
    buyVol += e.ni;
    sellVol += e.no;
    const tags = tagsFor(w, e, creator, supply);
    if (tags.includes('dev')) {
      devBought += e.bt;
      devSold += e.st;
      dev += e.bal;
    }
    if (tags.includes('sniper')) snC++;
    if (tags.includes('bundler')) bnC++;
    if (tags.includes('insider')) insC++;
    if (tags.includes('fresh')) frC++;
    if (e.bal <= 0) continue;
    holders++;
    balances.push(e.bal);
    if (tags.includes('sniper')) sn += e.bal;
    if (tags.includes('bundler')) bn += e.bal;
    if (tags.includes('insider')) ins += e.bal;
    if (tags.includes('fresh')) fr += e.bal;
    if (tags.includes('early')) early += e.bal;
  }
  balances.sort((a, b) => b - a);
  const top10 = balances.slice(0, 10).reduce((a, b) => a + b, 0);
  const devSeen = !!creator && creator in ledger;
  return {
    holders,
    top10Pct: pct(top10),
    devPct: devSeen ? pct(dev) : null,
    sniperPct: pct(sn),
    bundlerPct: pct(bn),
    insiderPct: pct(ins),
    freshPct: pct(fr),
    earlyHoldPct: pct(early),
    snipers: snC,
    bundlers: bnC,
    insiders: insC,
    fresh: frC,
    devHolds: dev > 0,
    devSoldAll: devSeen && devBought > 0 && dev <= devBought * 0.001,
    devSoldPct: devBought > 0 ? Math.min(100, Math.round((devSold / devBought) * 100)) : 0,
    buyVolNative: buyVol,
    sellVolNative: sellVol,
    updatedAt: Date.now(),
  };
}

/** A holder row for the coin page (sorted/filtered by the API). */
export interface HolderRow {
  wallet: string;
  tags: WalletTag[];
  balance: number;
  pctSupply: number | null;
  boughtNative: number;
  soldNative: number;
  /** value of remaining tokens in native at the current price */
  holdingNative: number | null;
  realizedNative: number;
  unrealizedNative: number | null;
  pnlNative: number | null;
  buys: number;
  sells: number;
  firstMs: number | null;
  rank: number | null;
  /** the wallet's Magura handle, if any */
  handle?: string | null;
}

/** Turn a ledger into rows. priceNative = native per token. */
export function holderRows(ledger: Record<string, LedgerEntry>, creator: string | null, supply: number | null, priceNative: number | null): HolderRow[] {
  return Object.entries(ledger).map(([wallet, e]) => {
    const holding = priceNative != null ? e.bal * priceNative : null;
    // realized = proceeds minus the cost basis of what was sold
    const avgCost = e.bt > 0 ? e.ni / e.bt : 0;
    const realized = e.no - avgCost * Math.min(e.st, e.bt);
    const unrealized = holding != null ? holding - avgCost * e.bal : null;
    return {
      wallet,
      tags: tagsFor(wallet, e, creator, supply),
      balance: e.bal,
      pctSupply: supply ? (e.bal / supply) * 100 : null,
      boughtNative: e.ni,
      soldNative: e.no,
      holdingNative: holding,
      realizedNative: realized,
      unrealizedNative: unrealized,
      pnlNative: unrealized != null ? realized + unrealized : null,
      buys: e.buys,
      sells: e.sells,
      firstMs: e.first,
      rank: e.rank,
    };
  });
}

export type HolderSort = 'holding' | 'pnl' | 'early' | 'bought';

export function sortHolders(rows: HolderRow[], by: HolderSort): HolderRow[] {
  const r = [...rows];
  if (by === 'holding') return r.filter((x) => x.balance > 0).sort((a, b) => b.balance - a.balance);
  if (by === 'pnl') return r.sort((a, b) => (b.pnlNative ?? b.realizedNative) - (a.pnlNative ?? a.realizedNative));
  if (by === 'early') return r.filter((x) => x.rank != null).sort((a, b) => a.rank! - b.rank!);
  return r.sort((a, b) => b.boughtNative - a.boughtNative);
}

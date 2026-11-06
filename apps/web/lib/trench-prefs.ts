'use client';

import { usePref } from './prefs';

/** Everything a Trenches card can show. Order = order on the card. */
export const CARD_FIELDS = [
  { id: 'mc', label: 'Market cap', group: 'market' },
  { id: 'vol', label: 'Volume', group: 'market' },
  { id: 'holders', label: 'Holders', group: 'market' },
  { id: 'tx', label: 'Buys / sells 5m', group: 'market' },
  { id: 'ath', label: 'ATH market cap', group: 'market' },
  { id: 'top10', label: 'Top 10 %', group: 'supply' },
  { id: 'dev', label: 'Dev %', group: 'supply' },
  { id: 'snipers', label: 'Snipers %', group: 'supply' },
  { id: 'bundlers', label: 'Bundlers %', group: 'supply' },
  { id: 'insiders', label: 'Insiders %', group: 'supply' },
  { id: 'fresh', label: 'Fresh wallets %', group: 'supply' },
  { id: 'socials', label: 'Socials', group: 'token' },
  { id: 'audit', label: 'Audit tags', group: 'token' },
  { id: 'launchpad', label: 'Launchpad', group: 'token' },
  { id: 'chat', label: 'Room activity', group: 'social' },
  { id: 'friends', label: 'Friends bought', group: 'social' },
] as const;

export type CardField = (typeof CARD_FIELDS)[number]['id'];

export interface TrenchPrefs {
  size: 'compact' | 'comfy' | 'large';
  fields: CardField[];
  progress: 'ring' | 'bar';
  logo: 'circle' | 'square';
  buttonSize: 'sm' | 'md' | 'lg';
  /** show a second quick-buy with a different amount */
  secondBuy: boolean;
  secondAmount: string;
  /** what tapping a card does on desktop */
  click: 'panel' | 'page';
  /** above these % the chip turns red */
  warn: { top10: number; dev: number; snipers: number; bundlers: number; insiders: number; fresh: number };
  /** hide coins whose dev has dumped */
  hideDevSold: boolean;
}

export const DEFAULT_TRENCH_PREFS: TrenchPrefs = {
  size: 'comfy',
  fields: ['mc', 'vol', 'holders', 'tx', 'top10', 'dev', 'snipers', 'bundlers', 'insiders', 'socials', 'chat', 'friends'],
  progress: 'ring',
  logo: 'square',
  buttonSize: 'md',
  secondBuy: false,
  secondAmount: '0.5',
  click: 'panel',
  warn: { top10: 30, dev: 10, snipers: 10, bundlers: 10, insiders: 10, fresh: 20 },
  hideDevSold: false,
};

export function useTrenchPrefs(): [TrenchPrefs, (p: TrenchPrefs) => void] {
  const [p, set] = usePref<TrenchPrefs>('trench-prefs', DEFAULT_TRENCH_PREFS);
  // fill in keys added after the user first saved
  return [{ ...DEFAULT_TRENCH_PREFS, ...p, warn: { ...DEFAULT_TRENCH_PREFS.warn, ...(p.warn ?? {}) } }, set];
}

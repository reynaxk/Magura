import type { ChainId, LaunchpadId } from '@magura/shared';

export interface LaunchEvent {
  type: 'created' | 'progress' | 'migrated';
  chain: ChainId;
  launchpad: LaunchpadId;
  address: string;
  symbol?: string;
  name?: string;
  imageUrl?: string | null;
  creator?: string;
  marketCapUsd?: number | null;
  /** 0–100 */
  bondingPct?: number | null;
  /** DEX pair after migration */
  pairAddress?: string;
  /** Off-chain metadata JSON (image, X, Telegram, website). */
  metadataUri?: string;
  at: Date;
}

export interface LaunchpadFeed {
  id: LaunchpadId;
  chain: ChainId;
  start(onEvent: (e: LaunchEvent) => void): Promise<void> | void;
  stop(): Promise<void> | void;
}

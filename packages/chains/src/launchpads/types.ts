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
  /** The wallet trade behind this event, when the feed knows it (create = dev's first buy). */
  trade?: LaunchTrade;
  at: Date;
}

export interface LaunchTrade {
  wallet: string;
  side: 'buy' | 'sell';
  /** Tokens moved (UI units). */
  tokenAmount: number;
  /** Native coin moved (SOL/BNB/ETH). */
  nativeAmount: number;
  /** Wallet's token balance after the trade, when the feed reports it. */
  balanceAfter?: number | null;
  signature?: string;
}

export interface LaunchpadFeed {
  id: LaunchpadId;
  chain: ChainId;
  start(onEvent: (e: LaunchEvent) => void): Promise<void> | void;
  stop(): Promise<void> | void;
}

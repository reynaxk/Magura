import type { ChainId, LaunchpadId } from './chains';

/** Trenches stages — named the way Magura users talk. */
export type TrenchStage = 'new' | 'almost' | 'survived';

export interface TokenRisk {
  top10Pct: number | null;
  devPct: number | null;
  sniperPct: number | null;
  honeypot: boolean | null;
  mintable: boolean | null;
  freezable: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
}

export interface TrenchToken {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  launchpad: LaunchpadId | null;
  stage: TrenchStage;
  createdAt: string;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  holders: number | null;
  /** Bonding-curve progress 0–100 (100 once migrated). */
  bondingPct: number | null;
  buys: number | null;
  sells: number | null;
  risk: TokenRisk | null;
  /** Social layer */
  chatCount: number;
  friendsBought: { userId: string; handle: string; avatarUrl: string | null }[];
}

export interface PairSummary {
  chain: ChainId;
  pairAddress: string;
  dex: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string };
  priceUsd: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  pairCreatedAt: string | null;
  imageUrl: string | null;
}

export interface Candle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface SwapQuoteRequest {
  chain: ChainId;
  inputToken: string;
  outputToken: string;
  /** Amount in base units (lamports / wei) as a string. */
  amount: string;
  slippageBps: number;
  userAddress: string;
}

export interface SwapQuote {
  chain: ChainId;
  provider: 'jupiter' | 'kyberswap' | 'openocean';
  inputToken: string;
  outputToken: string;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: number | null;
  route: string[];
  /** Opaque provider payload needed to build the tx. */
  raw: unknown;
}

export interface SwapTx {
  chain: ChainId;
  provider: SwapQuote['provider'];
  /** Solana: base64 versioned tx. EVM: tx request. */
  solanaTxBase64?: string;
  evmTx?: { to: string; data: string; value: string; gas?: string };
  /** EVM: ERC20 approval needed first. */
  approval?: { token: string; spender: string; amount: string };
}

/** Chat */
export type RoomKind = 'coin' | 'world' | 'channel' | 'dm' | 'stream';

export interface ChatMessageDTO {
  id: string;
  roomId: string;
  author: { id: string; handle: string; avatarUrl: string | null; badges: string[] };
  text: string;
  /** Attached trade or call card. */
  attachment: TradeAttachment | CallAttachment | null;
  createdAt: string;
}

export interface TradeAttachment {
  kind: 'trade';
  side: 'buy' | 'sell';
  chain: ChainId;
  token: { address: string; symbol: string };
  amountUsd: number | null;
  price: number | null;
  /** % of position when selling. */
  pct: number | null;
  txHash: string | null;
}

export interface CallAttachment {
  kind: 'call';
  chain: ChainId;
  token: { address: string; symbol: string };
  buyZone: string;
  target: string;
  invalidation: string;
}

/**
 * Supported chains. Magura is SPOT ONLY — no perps anywhere.
 */
export type ChainId = 'solana' | 'base' | 'bsc' | 'ethereum';

export type ChainKind = 'svm' | 'evm';

export interface ChainConfig {
  id: ChainId;
  name: string;
  kind: ChainKind;
  /** EVM numeric chain id (undefined for Solana). */
  evmChainId?: number;
  nativeSymbol: string;
  /** Wrapped native / quote token used for quick-buy. */
  quoteToken: { address: string; symbol: string; decimals: number };
  /** Stablecoin used for copy-trading budgets. */
  stable: { address: string; symbol: string; decimals: number };
  /** DexScreener chain slug. */
  dexscreener: string;
  /** GeckoTerminal network slug. */
  geckoterminal: string;
  /** GoPlus chain id ("solana" or numeric string). */
  goplus: string;
  /** KyberSwap aggregator chain slug (EVM only). */
  kyberswap?: string;
  explorer: string;
  /** Launchpads that feed the Trenches on this chain. */
  launchpads: LaunchpadId[];
}

export type LaunchpadId = 'pumpfun' | 'clanker' | 'fourmeme' | 'flap' | 'pons';

export const CHAINS: Record<ChainId, ChainConfig> = {
  solana: {
    id: 'solana',
    name: 'Solana',
    kind: 'svm',
    nativeSymbol: 'SOL',
    quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
    stable: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
    dexscreener: 'solana',
    geckoterminal: 'solana',
    goplus: 'solana',
    explorer: 'https://solscan.io',
    launchpads: ['pumpfun', 'pons'],
  },
  base: {
    id: 'base',
    name: 'Base',
    kind: 'evm',
    evmChainId: 8453,
    nativeSymbol: 'ETH',
    quoteToken: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
    stable: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
    dexscreener: 'base',
    geckoterminal: 'base',
    goplus: '8453',
    kyberswap: 'base',
    explorer: 'https://basescan.org',
    launchpads: ['clanker'],
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Chain',
    kind: 'evm',
    evmChainId: 56,
    nativeSymbol: 'BNB',
    quoteToken: { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', decimals: 18 },
    stable: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
    dexscreener: 'bsc',
    geckoterminal: 'bsc',
    goplus: '56',
    kyberswap: 'bsc',
    explorer: 'https://bscscan.com',
    launchpads: ['fourmeme', 'flap'],
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    kind: 'evm',
    evmChainId: 1,
    nativeSymbol: 'ETH',
    quoteToken: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
    stable: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
    dexscreener: 'ethereum',
    geckoterminal: 'eth',
    goplus: '1',
    kyberswap: 'ethereum',
    explorer: 'https://etherscan.io',
    launchpads: [],
  },
};

export const CHAIN_IDS = Object.keys(CHAINS) as ChainId[];

/** Placeholder address used by EVM aggregators for the native coin. */
export const EVM_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export function isChainId(v: string): v is ChainId {
  return v in CHAINS;
}

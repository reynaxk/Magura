import { CHAINS, type SwapQuote, type SwapQuoteRequest, type SwapTx } from '@magura/shared';
import { jupiter } from './jupiter';
import { kyberswap } from './kyberswap';

export { jupiter } from './jupiter';
export { kyberswap } from './kyberswap';
export { openocean } from './openocean';

/** Best spot quote for any supported chain. Solana → Jupiter, EVM → KyberSwap. */
export async function getQuote(req: SwapQuoteRequest): Promise<SwapQuote> {
  return CHAINS[req.chain].kind === 'svm' ? jupiter.quote(req) : kyberswap.quote(req);
}

export async function buildSwapTx(quote: SwapQuote, userAddress: string): Promise<SwapTx> {
  switch (quote.provider) {
    case 'jupiter':
      return jupiter.buildTx(quote, userAddress);
    case 'kyberswap':
      return kyberswap.buildTx(quote, userAddress);
    default:
      throw new Error(`Rebuild not supported for ${quote.provider}; request a fresh quote`);
  }
}

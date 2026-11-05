import { CHAINS, type SwapQuote, type SwapQuoteRequest, type SwapTx } from '@magura/shared';
import { fetchJson } from '../http';

/**
 * OpenOcean — fallback EVM aggregator only. It was blocked by Cloudflare in the
 * old terminal, so call it from the API server (Railway), never from Workers.
 */
const BASE = 'https://open-api.openocean.finance/v4';

export const openocean = {
  async quoteAndBuild(req: SwapQuoteRequest, decimalsIn: number): Promise<{ quote: SwapQuote; tx: SwapTx }> {
    const chain = CHAINS[req.chain];
    if (chain.kind !== 'evm') throw new Error('OpenOcean fallback is EVM only');
    // v4 swap expects a human-readable amount
    const human = (Number(req.amount) / 10 ** decimalsIn).toString();
    const params = new URLSearchParams({
      inTokenAddress: req.inputToken,
      outTokenAddress: req.outputToken,
      amount: human,
      gasPrice: '1',
      slippage: (req.slippageBps / 100).toString(),
      account: req.userAddress,
    });
    const res = await fetchJson<{ data: { to: string; data: string; value: string; outAmount: string; minOutAmount: string; inAmount: string } }>(
      `${BASE}/${chain.evmChainId}/swap?${params}`,
    );
    const d = res.data;
    return {
      quote: {
        chain: req.chain,
        provider: 'openocean',
        inputToken: req.inputToken,
        outputToken: req.outputToken,
        inAmount: d.inAmount,
        outAmount: d.outAmount,
        minOutAmount: d.minOutAmount,
        priceImpactPct: null,
        route: ['openocean'],
        fee: { bps: 0, amount: '0', usd: null, side: 'in', receiver: null },
        raw: d,
      },
      tx: { chain: req.chain, provider: 'openocean', evmTx: { to: d.to, data: d.data, value: d.value } },
    };
  },
};

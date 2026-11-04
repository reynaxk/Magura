import { CHAINS, type SwapQuote, type SwapQuoteRequest, type SwapTx } from '@magura/shared';
import { fetchJson, num } from '../http';

const BASE = 'https://aggregator-api.kyberswap.com';

function headers(): Record<string, string> {
  return { 'x-client-id': process.env.KYBERSWAP_CLIENT_ID ?? 'magura' };
}

interface KyberRoute {
  data: {
    routeSummary: {
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      amountOut: string;
      route: { exchange: string }[][];
    };
    routerAddress: string;
  };
}

export const kyberswap = {
  async quote(req: SwapQuoteRequest): Promise<SwapQuote> {
    const slug = CHAINS[req.chain].kyberswap;
    if (!slug) throw new Error(`KyberSwap does not support ${req.chain}`);
    const params = new URLSearchParams({ tokenIn: req.inputToken, tokenOut: req.outputToken, amountIn: req.amount });
    const r = await fetchJson<KyberRoute>(`${BASE}/${slug}/api/v1/routes?${params}`, { headers: headers() });
    const s = r.data.routeSummary;
    const minOut = (BigInt(s.amountOut) * BigInt(10_000 - req.slippageBps)) / 10_000n;
    return {
      chain: req.chain,
      provider: 'kyberswap',
      inputToken: s.tokenIn,
      outputToken: s.tokenOut,
      inAmount: s.amountIn,
      outAmount: s.amountOut,
      minOutAmount: minOut.toString(),
      priceImpactPct: null,
      route: s.route.flat().map((h) => h.exchange),
      raw: { ...r.data, slippageBps: req.slippageBps },
    };
  },

  async buildTx(quote: SwapQuote, userAddress: string): Promise<SwapTx> {
    const slug = CHAINS[quote.chain].kyberswap!;
    const raw = quote.raw as KyberRoute['data'] & { slippageBps: number };
    const res = await fetchJson<{ data: { data: string; routerAddress: string; transactionValue: string; gas?: string } }>(
      `${BASE}/${slug}/api/v1/route/build`,
      {
        method: 'POST',
        headers: headers(),
        body: {
          routeSummary: raw.routeSummary,
          sender: userAddress,
          recipient: userAddress,
          slippageTolerance: raw.slippageBps,
          source: 'magura',
        },
      },
    );
    const isNativeIn = quote.inputToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    return {
      chain: quote.chain,
      provider: 'kyberswap',
      evmTx: { to: res.data.routerAddress, data: res.data.data, value: res.data.transactionValue ?? '0', gas: res.data.gas },
      approval: isNativeIn ? undefined : { token: quote.inputToken, spender: res.data.routerAddress, amount: quote.inAmount },
    };
  },

  num,
};

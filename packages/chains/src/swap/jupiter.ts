import type { SwapQuote, SwapQuoteRequest, SwapTx } from '@magura/shared';
import { fetchJson, num } from '../http';

/**
 * Jupiter Swap API (Solana). Uses api.jup.ag with an API key when provided,
 * otherwise the free lite-api host.
 */
function base() {
  return process.env.JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag';
}
function headers(): Record<string, string> {
  return process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {};
}

interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: { swapInfo: { label?: string } }[];
}

export const jupiter = {
  async quote(req: SwapQuoteRequest): Promise<SwapQuote> {
    const params = new URLSearchParams({
      inputMint: req.inputToken,
      outputMint: req.outputToken,
      amount: req.amount,
      slippageBps: String(req.slippageBps),
      restrictIntermediateTokens: 'true',
    });
    const q = await fetchJson<JupQuote>(`${base()}/swap/v1/quote?${params}`, { headers: headers() });
    return {
      chain: 'solana',
      provider: 'jupiter',
      inputToken: q.inputMint,
      outputToken: q.outputMint,
      inAmount: q.inAmount,
      outAmount: q.outAmount,
      minOutAmount: q.otherAmountThreshold,
      priceImpactPct: num(q.priceImpactPct) != null ? Number(q.priceImpactPct) * 100 : null,
      route: q.routePlan.map((r) => r.swapInfo.label ?? '?'),
      raw: q,
    };
  },

  /** Build an unsigned versioned transaction for the user's wallet to sign. */
  async buildTx(quote: SwapQuote, userPublicKey: string, opts: { priorityLamports?: number } = {}): Promise<SwapTx> {
    const res = await fetchJson<{ swapTransaction: string }>(`${base()}/swap/v1/swap`, {
      method: 'POST',
      headers: headers(),
      body: {
        quoteResponse: quote.raw,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: opts.priorityLamports
          ? { priorityLevelWithMaxLamports: { maxLamports: opts.priorityLamports, priorityLevel: 'veryHigh' } }
          : 'auto',
      },
    });
    return { chain: 'solana', provider: 'jupiter', solanaTxBase64: res.swapTransaction };
  },

  /** Token search (name, symbol or mint). */
  async searchTokens(query: string): Promise<{ id: string; name: string; symbol: string; icon?: string; decimals: number }[]> {
    return fetchJson(`${base()}/tokens/v2/search?query=${encodeURIComponent(query)}`, { headers: headers() });
  },

  /** Trigger (limit) order — create. Returns an unsigned tx. */
  async createTriggerOrder(p: {
    maker: string;
    inputMint: string;
    outputMint: string;
    makingAmount: string;
    takingAmount: string;
  }): Promise<{ order: string; transaction: string; requestId: string }> {
    return fetchJson(`${base()}/trigger/v1/createOrder`, {
      method: 'POST',
      headers: headers(),
      body: { ...p, payer: p.maker, params: { makingAmount: p.makingAmount, takingAmount: p.takingAmount } },
    });
  },
};

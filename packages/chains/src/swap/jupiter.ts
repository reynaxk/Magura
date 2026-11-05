import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { SwapQuote, SwapQuoteRequest, SwapTx } from '@magura/shared';
import { fetchJson, num } from '../http';
import { rpcUrl } from '../rpc';

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

interface JupIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

interface JupSwapInstructions {
  computeBudgetInstructions?: JupIx[];
  setupInstructions?: JupIx[];
  swapInstruction: JupIx;
  cleanupInstruction?: JupIx | null;
  otherInstructions?: JupIx[];
  addressLookupTableAddresses?: string[];
}

const toIx = (ix: JupIx) =>
  new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, 'base64'),
  });

const NO_FEE: SwapQuote['fee'] = { bps: 0, amount: '0', usd: null, side: 'in', receiver: null };

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
      fee: NO_FEE,
      raw: q,
    };
  },

  /**
   * Build an unsigned v0 transaction for the user's wallet to sign.
   * When the quote carries a Magura fee, a SOL transfer to the treasury is added:
   * before the swap for buys (fee taken from the SOL being spent), after the
   * wSOL cleanup for sells (fee taken from the SOL received).
   */
  async buildTx(quote: SwapQuote, userPublicKey: string, opts: { priorityLamports?: number } = {}): Promise<SwapTx> {
    const ixs = await fetchJson<JupSwapInstructions>(`${base()}/swap/v1/swap-instructions`, {
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

    const user = new PublicKey(userPublicKey);
    const feeIx =
      quote.fee.receiver && BigInt(quote.fee.amount) > 0n
        ? SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(quote.fee.receiver), lamports: BigInt(quote.fee.amount) })
        : null;

    const instructions: TransactionInstruction[] = [
      ...(ixs.computeBudgetInstructions ?? []).map(toIx),
      ...(feeIx && quote.fee.side === 'in' ? [feeIx] : []),
      ...(ixs.otherInstructions ?? []).map(toIx),
      ...(ixs.setupInstructions ?? []).map(toIx),
      toIx(ixs.swapInstruction),
      ...(ixs.cleanupInstruction ? [toIx(ixs.cleanupInstruction)] : []),
      ...(feeIx && quote.fee.side === 'out' ? [feeIx] : []),
    ];

    const conn = new Connection(rpcUrl('solana'), 'confirmed');
    const alts = await Promise.all(
      (ixs.addressLookupTableAddresses ?? []).map(async (a) => (await conn.getAddressLookupTable(new PublicKey(a))).value),
    );
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions }).compileToV0Message(
      alts.filter((a): a is AddressLookupTableAccount => !!a),
    );
    const tx = new VersionedTransaction(message);
    return { chain: 'solana', provider: 'jupiter', solanaTxBase64: Buffer.from(tx.serialize()).toString('base64') };
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

import { createPublicClient, http, type PublicClient } from 'viem';
import { base, bsc, mainnet } from 'viem/chains';
import type { ChainId } from '@magura/shared';

/**
 * RPC priority: QuickNode → Helius (Solana) → public fallback.
 * Env: QUICKNODE_<CHAIN>_URL, HELIUS_RPC_URL.
 */
const PUBLIC: Record<ChainId, string[]> = {
  solana: ['https://api.mainnet-beta.solana.com'],
  base: ['https://mainnet.base.org'],
  bsc: ['https://bsc-dataseed.bnbchain.org'],
  ethereum: ['https://eth.llamarpc.com'],
};

export function rpcUrls(chain: ChainId): string[] {
  const qn = process.env[`QUICKNODE_${chain.toUpperCase()}_URL`];
  const helius = chain === 'solana' ? process.env.HELIUS_RPC_URL : undefined;
  return [qn, helius, ...PUBLIC[chain]].filter((u): u is string => !!u);
}

export function rpcUrl(chain: ChainId): string {
  return rpcUrls(chain)[0];
}

const viemChains = { base, bsc, ethereum: mainnet } as const;
const clients = new Map<ChainId, PublicClient>();

export function evmClient(chain: Exclude<ChainId, 'solana'>): PublicClient {
  let c = clients.get(chain);
  if (!c) {
    c = createPublicClient({ chain: viemChains[chain], transport: http(rpcUrl(chain)) }) as PublicClient;
    clients.set(chain, c);
  }
  return c;
}

/** Minimal Solana JSON-RPC call (avoids pulling @solana/web3.js into the server). */
export async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown;
  for (const url of rpcUrls('solana')) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const json = (await res.json()) as { result?: T; error?: { message: string } };
      if (json.error) throw new Error(json.error.message);
      return json.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

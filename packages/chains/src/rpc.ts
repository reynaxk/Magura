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

/** Native balance in base units (lamports / wei). */
export async function nativeBalance(chain: ChainId, address: string): Promise<bigint> {
  if (chain === 'solana') {
    const r = await solanaRpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]);
    return BigInt(r.value);
  }
  return evmClient(chain).getBalance({ address: address as `0x${string}` });
}

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

/** Token balance in base units plus decimals. Solana sums every token account the owner has for the mint (SPL + Token-2022). */
export async function tokenBalance(chain: ChainId, owner: string, token: string): Promise<{ amount: bigint; decimals: number }> {
  if (chain === 'solana') {
    const r = await solanaRpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number } } } } } }[] }>(
      'getTokenAccountsByOwner',
      [owner, { mint: token }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
    );
    let amount = 0n;
    let decimals = 0;
    for (const a of r.value) {
      const t = a.account.data.parsed.info.tokenAmount;
      amount += BigInt(t.amount);
      decimals = t.decimals;
    }
    return { amount, decimals };
  }
  const c = evmClient(chain);
  const [amount, decimals] = await Promise.all([
    c.readContract({ address: token as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner as `0x${string}`] }),
    c.readContract({ address: token as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' }),
  ]);
  return { amount: amount as bigint, decimals: Number(decimals) };
}

/** Token decimals (SPL mint or ERC-20). */
export async function tokenDecimals(chain: ChainId, token: string): Promise<number> {
  if (chain === 'solana') {
    const r = await solanaRpc<{ value: { decimals: number } }>('getTokenSupply', [token]);
    return r.value.decimals;
  }
  const d = await evmClient(chain).readContract({ address: token as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' });
  return Number(d);
}

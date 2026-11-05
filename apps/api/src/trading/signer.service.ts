import { Injectable } from '@nestjs/common';
import { encodeFunctionData, erc20Abi } from 'viem';
import { CHAINS, type ChainId, type SwapTx } from '@magura/shared';
import { AuthService } from '../auth/auth.service';

const CAIP2: Record<ChainId, string> = {
  solana: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  base: 'eip155:8453',
  bsc: 'eip155:56',
  ethereum: 'eip155:1',
};

/** Signs and sends a built swap through a user's Privy wallet, where they granted Magura a session signer. */
@Injectable()
export class SignerService {
  constructor(private readonly auth: AuthService) {}

  get available() {
    return !!this.auth.privy;
  }

  async send(chain: ChainId, privyWalletId: string, tx: SwapTx): Promise<string> {
    const privy = this.auth.privy;
    if (!privy) throw new Error('server_signing_unavailable');
    if (tx.solanaTxBase64) {
      const { VersionedTransaction } = await import('@solana/web3.js');
      const res = await privy.walletApi.solana.signAndSendTransaction({
        walletId: privyWalletId,
        caip2: CAIP2.solana as any,
        transaction: VersionedTransaction.deserialize(Buffer.from(tx.solanaTxBase64, 'base64')),
      });
      return res.hash;
    }
    if (tx.approval) {
      await privy.walletApi.ethereum.sendTransaction({
        walletId: privyWalletId,
        caip2: CAIP2[chain] as any,
        transaction: {
          to: tx.approval.token as `0x${string}`,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [tx.approval.spender as `0x${string}`, BigInt(tx.approval.amount)] }),
          chainId: CHAINS[chain].evmChainId!,
        },
      });
    }
    const res = await privy.walletApi.ethereum.sendTransaction({
      walletId: privyWalletId,
      caip2: CAIP2[chain] as any,
      transaction: { to: tx.evmTx!.to as `0x${string}`, data: tx.evmTx!.data as `0x${string}`, value: BigInt(tx.evmTx!.value) as any, chainId: CHAINS[chain].evmChainId! },
    });
    return res.hash;
  }
}

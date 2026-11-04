import { parseAbiItem, type AbiEvent, type Address } from 'viem';
import type { ChainId, LaunchpadId } from '@magura/shared';
import { evmClient } from '../rpc';
import type { LaunchEvent, LaunchpadFeed } from './types';

/**
 * Generic EVM launchpad watcher: listens for a factory's "token created" event.
 * Used for Four.meme and Flap on BNB Chain (and Pons when configured).
 *
 * The factory address + event signature come from env so they can be updated
 * without a deploy. Port the exact values from the old terminal:
 *   FOURMEME_FACTORY, FOURMEME_CREATE_EVENT
 *   FLAP_FACTORY,     FLAP_CREATE_EVENT
 * The event must have a `token` address arg; `name`/`symbol`/`creator` are used if present.
 */
export interface EvmFactoryConfig {
  id: LaunchpadId;
  chain: Exclude<ChainId, 'solana'>;
  factory: Address;
  eventSignature: string;
}

export class EvmFactoryFeed implements LaunchpadFeed {
  readonly id: LaunchpadId;
  readonly chain: Exclude<ChainId, 'solana'>;
  private unwatch: (() => void) | null = null;
  private readonly event: AbiEvent;

  constructor(private readonly cfg: EvmFactoryConfig) {
    this.id = cfg.id;
    this.chain = cfg.chain;
    this.event = parseAbiItem(cfg.eventSignature) as AbiEvent;
  }

  start(onEvent: (e: LaunchEvent) => void) {
    const client = evmClient(this.cfg.chain);
    this.unwatch = client.watchEvent({
      address: this.cfg.factory,
      event: this.event,
      pollingInterval: 3000,
      onLogs: (logs) => {
        for (const log of logs as any[]) {
          const a = log.args ?? {};
          const token: string | undefined = a.token ?? a.tokenAddress ?? a.addr;
          if (!token) continue;
          onEvent({
            type: 'created',
            chain: this.cfg.chain,
            launchpad: this.cfg.id,
            address: token.toLowerCase(),
            symbol: a.symbol,
            name: a.name,
            creator: a.creator ?? a.owner,
            imageUrl: null,
            bondingPct: 0,
            at: new Date(),
          });
        }
      },
    });
  }

  stop() {
    this.unwatch?.();
  }
}

/** Build feeds that are configured in env; unconfigured launchpads are skipped. */
export function evmFactoryFeedsFromEnv(env = process.env): EvmFactoryFeed[] {
  const defs: { id: LaunchpadId; chain: Exclude<ChainId, 'solana'>; prefix: string }[] = [
    { id: 'fourmeme', chain: 'bsc', prefix: 'FOURMEME' },
    { id: 'flap', chain: 'bsc', prefix: 'FLAP' },
    { id: 'pons', chain: (env.PONS_CHAIN as Exclude<ChainId, 'solana'>) ?? 'bsc', prefix: 'PONS' },
  ];
  return defs
    .filter((d) => env[`${d.prefix}_FACTORY`] && env[`${d.prefix}_CREATE_EVENT`])
    .map(
      (d) =>
        new EvmFactoryFeed({
          id: d.id,
          chain: d.chain,
          factory: env[`${d.prefix}_FACTORY`] as Address,
          eventSignature: env[`${d.prefix}_CREATE_EVENT`]!,
        }),
    );
}

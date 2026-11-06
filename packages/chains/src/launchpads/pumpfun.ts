import WebSocket from 'ws';
import { fetchJson } from '../http';
import type { LaunchEvent, LaunchpadFeed } from './types';

/**
 * Pump.fun via PumpPortal's free data websocket.
 * newToken → created, tokenTrade → bonding progress, migration → survived.
 */
const WS_URL = 'wss://pumpportal.fun/api/data';

// Pump.fun curve starts at ~30 virtual SOL and completes around ~115 virtual SOL.
const START_VSOL = 30;
const END_VSOL = 115;

export function pumpBondingPct(vSolInBondingCurve: number): number {
  return Math.max(0, Math.min(100, ((vSolInBondingCurve - START_VSOL) / (END_VSOL - START_VSOL)) * 100));
}

export class PumpFunFeed implements LaunchpadFeed {
  readonly id = 'pumpfun' as const;
  readonly chain = 'solana' as const;
  private ws: WebSocket | null = null;
  private stopped = false;
  private tracked = new Set<string>();
  private solUsd = 0;

  constructor(private readonly getSolUsd: () => number) {}

  start(onEvent: (e: LaunchEvent) => void) {
    this.stopped = false;
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      ws.on('open', () => {
        ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
        ws.send(JSON.stringify({ method: 'subscribeMigration' }));
        if (this.tracked.size) ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [...this.tracked] }));
      });
      ws.on('message', (raw) => {
        let m: any;
        try {
          m = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this.solUsd = this.getSolUsd() || this.solUsd;
        if (m.txType === 'create' && m.mint) {
          this.track(m.mint);
          onEvent({
            type: 'created',
            chain: 'solana',
            launchpad: 'pumpfun',
            address: m.mint,
            symbol: m.symbol,
            name: m.name,
            imageUrl: null,
            creator: m.traderPublicKey,
            marketCapUsd: m.marketCapSol ? m.marketCapSol * this.solUsd : null,
            bondingPct: m.vSolInBondingCurve ? pumpBondingPct(m.vSolInBondingCurve) : 0,
            metadataUri: m.uri,
            trade:
              m.traderPublicKey && Number(m.initialBuy) > 0
                ? {
                    wallet: m.traderPublicKey,
                    side: 'buy',
                    tokenAmount: Number(m.initialBuy),
                    nativeAmount: Number(m.solAmount) || 0,
                    balanceAfter: Number(m.initialBuy),
                    signature: m.signature,
                  }
                : undefined,
            at: new Date(),
          });
        } else if ((m.txType === 'buy' || m.txType === 'sell') && m.mint) {
          onEvent({
            type: 'progress',
            chain: 'solana',
            launchpad: 'pumpfun',
            address: m.mint,
            marketCapUsd: m.marketCapSol ? m.marketCapSol * this.solUsd : null,
            bondingPct: m.vSolInBondingCurve ? pumpBondingPct(m.vSolInBondingCurve) : null,
            trade: m.traderPublicKey
              ? {
                  wallet: m.traderPublicKey,
                  side: m.txType,
                  tokenAmount: Number(m.tokenAmount) || 0,
                  nativeAmount: Number(m.solAmount) || 0,
                  balanceAfter: m.newTokenBalance != null ? Number(m.newTokenBalance) : null,
                  signature: m.signature,
                }
              : undefined,
            at: new Date(),
          });
        } else if (m.txType === 'migrate' || (m.mint && m.pool)) {
          onEvent({ type: 'migrated', chain: 'solana', launchpad: 'pumpfun', address: m.mint, bondingPct: 100, at: new Date() });
          this.untrack(m.mint);
        }
      });
      ws.on('close', () => {
        if (!this.stopped) setTimeout(connect, 2000);
      });
      ws.on('error', () => ws.close());
    };
    connect();
  }

  /** Follow trades for a token so we get bonding progress. Keep the set bounded. */
  track(mint: string) {
    if (this.tracked.has(mint)) return;
    this.tracked.add(mint);
    if (this.tracked.size > 500) {
      const oldest = this.tracked.values().next().value as string;
      this.untrack(oldest);
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
  }

  untrack(mint: string) {
    this.tracked.delete(mint);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [mint] }));
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }
}

/** Build a bonding-curve buy/sell tx via PumpPortal Local Transaction API (user signs). */
export async function pumpPortalTradeTx(p: {
  publicKey: string;
  action: 'buy' | 'sell';
  mint: string;
  amount: number | string; // SOL for buys (denominatedInSol), tokens or "100%" for sells
  denominatedInSol: boolean;
  slippagePct: number;
  priorityFeeSol?: number;
}): Promise<string> {
  const res = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicKey: p.publicKey,
      action: p.action,
      mint: p.mint,
      amount: p.amount,
      denominatedInSol: String(p.denominatedInSol),
      slippage: p.slippagePct,
      priorityFee: p.priorityFeeSol ?? 0.0005,
      pool: 'auto',
    }),
  });
  if (!res.ok) throw new Error(`PumpPortal ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

/** Token metadata (image) lives at the IPFS uri returned on create. */
export async function pumpMetadata(uri: string): Promise<{ image?: string; twitter?: string; telegram?: string; website?: string } | null> {
  try {
    return await fetchJson(uri, { timeoutMs: 4000, retries: 0 });
  } catch {
    return null;
  }
}

/** One bonding-curve trade from pump.fun's own API. */
export interface PumpTrade {
  signature: string;
  wallet: string;
  side: 'buy' | 'sell';
  /** UI units (6 decimals on pump.fun) */
  tokenAmount: number;
  /** SOL */
  solAmount: number;
  at: Date;
  slot: number | null;
}

/**
 * Trades on a pump.fun coin (newest first, up to `limit`), with slot numbers —
 * the free replacement for PumpPortal's per-coin stream, which became paid.
 */
export async function pumpTrades(mint: string, limit = 200, offset = 0): Promise<PumpTrade[]> {
  const rows = await fetchJson<any[]>(`https://frontend-api-v3.pump.fun/trades/all/${mint}?limit=${limit}&offset=${offset}&minimumSize=0`, {
    timeoutMs: 6000,
    retries: 0,
    headers: { origin: 'https://pump.fun', referer: 'https://pump.fun/', 'user-agent': 'Mozilla/5.0 (compatible; Magura/1.0)' },
  });
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && r.signature && r.user)
    .map((r) => ({
      signature: String(r.signature),
      wallet: String(r.user),
      side: r.is_buy ? 'buy' : 'sell',
      tokenAmount: Number(r.token_amount) / 1e6,
      solAmount: Number(r.sol_amount) / 1e9,
      at: new Date(Number(r.timestamp) * (Number(r.timestamp) < 1e12 ? 1000 : 1)),
      slot: r.slot != null ? Number(r.slot) : null,
    }));
}

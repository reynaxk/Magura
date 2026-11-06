import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { rpcUrls } from '../rpc';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/** Anchor event discriminator: first 8 bytes of sha256("event:<Name>"). */
const disc = (name: string) => createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
const TRADE = disc('TradeEvent');

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf: Buffer): string {
  let n = BigInt(`0x${buf.toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export interface PumpLogTrade {
  mint: string;
  wallet: string;
  side: 'buy' | 'sell';
  solAmount: number;
  tokenAmount: number;
  at: Date;
  slot: number;
  signature: string;
}

/**
 * Decode a pump.fun TradeEvent ("Program data: …" log line).
 * Layout prefix: mint(32) sol_amount(u64) token_amount(u64) is_buy(bool) user(32) timestamp(i64) …
 */
export function decodePumpTrade(base64: string): Omit<PumpLogTrade, 'slot' | 'signature'> | null {
  const b = Buffer.from(base64, 'base64');
  if (b.length < 8 + 32 + 8 + 8 + 1 + 32 + 8 || !b.subarray(0, 8).equals(TRADE)) return null;
  let o = 8;
  const mint = b58(b.subarray(o, o + 32));
  o += 32;
  const sol = b.readBigUInt64LE(o);
  o += 8;
  const tok = b.readBigUInt64LE(o);
  o += 8;
  const isBuy = b[o] === 1;
  o += 1;
  const user = b58(b.subarray(o, o + 32));
  o += 32;
  const ts = Number(b.readBigInt64LE(o));
  return { mint, wallet: user, side: isBuy ? 'buy' : 'sell', solAmount: Number(sol) / 1e9, tokenAmount: Number(tok) / 1e6, at: new Date(ts * 1000) };
}

/**
 * Every pump.fun trade, live, from the program's on-chain logs (Solana `logsSubscribe`).
 * Uses HELIUS_RPC_URL / QUICKNODE_SOLANA_URL when set, else the public endpoint.
 */
export class PumpLogsFeed {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoff = 2000;
  lastMessageAt = 0;

  constructor(private readonly onTrade: (t: PumpLogTrade) => void) {}

  private wsUrl(): string {
    const http = rpcUrls('solana')[0];
    return http.replace(/^http/, 'ws');
  }

  start() {
    this.stopped = false;
    const connect = () => {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;
      ws.on('open', () => {
        this.backoff = 2000;
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [PUMP_PROGRAM] }, { commitment: 'confirmed' }] }));
      });
      ws.on('message', (raw) => {
        this.lastMessageAt = Date.now();
        let m: any;
        try {
          m = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const v = m?.params?.result?.value;
        const slot = m?.params?.result?.context?.slot;
        if (!v || v.err || !Array.isArray(v.logs)) return;
        for (const line of v.logs as string[]) {
          if (!line.startsWith('Program data: ')) continue;
          const t = decodePumpTrade(line.slice(14));
          if (t) this.onTrade({ ...t, slot: Number(slot), signature: v.signature });
        }
      });
      ws.on('close', () => {
        if (this.stopped) return;
        setTimeout(connect, this.backoff);
        this.backoff = Math.min(60_000, this.backoff * 2);
      });
      ws.on('error', () => ws.close());
    };
    connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }
}

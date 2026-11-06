import type { ChatMessageDTO, SignalDTO, TrenchToken } from './types';

export interface RtcTrack {
  userId: string;
  handle: string;
  sessionId: string;
  trackName: string;
  kind: 'audio' | 'video' | 'screen';
}

/** Socket.IO event contract shared by API and web. */
export interface ServerToClientEvents {
  'chat:message': (msg: ChatMessageDTO) => void;
  'chat:presence': (p: { roomId: string; online: number }) => void;
  'chat:typing': (p: { roomId: string; userId: string; handle: string }) => void;
  'trenches:token': (t: TrenchToken) => void;
  'trenches:update': (t: Partial<TrenchToken> & { chain: string; address: string }) => void;
  /** Monitor feed. */
  'signal': (s: SignalDTO) => void;
  /** The coin's creator sold (soldAll = dumped everything). */
  'coin:devsell': (e: { chain: string; address: string; soldAll: boolean; at: string }) => void;
  'copy:executed': (p: { subscriptionId: string; side: 'buy' | 'sell'; symbol: string; amountUsd: number; txHash: string | null }) => void;
  'order:fired': (p: { orderId: string; kind: string; side: 'buy' | 'sell'; symbol: string; chain: string; token: string; needsConfirm: boolean; txHash: string | null }) => void;
  'copy:confirm': (p: { executionId: string; leader: string; side: 'buy' | 'sell'; symbol: string; amountUsd: number }) => void;
  'call:ring': (p: { callId: string; from: { id: string; handle: string }; video: boolean }) => void;
  'call:ended': (p: { callId: string }) => void;
  /** Published media tracks changed in a call or stream scope ("call:<id>" | "stream:<id>"). */
  'rtc:tracks': (p: { scope: string; tracks: RtcTrack[] }) => void;
  'stream:live': (p: { streamId: string; hostHandle: string; title: string }) => void;
  'notification': (p: { id: string; kind: string; title: string; body: string; href: string | null }) => void;
}

export interface ClientToServerEvents {
  'room:join': (roomId: string, ack?: (ok: boolean) => void) => void;
  'room:leave': (roomId: string) => void;
  'chat:send': (
    p: { roomId: string; text: string; attachment?: ChatMessageDTO['attachment'] },
    ack?: (res: { ok: true; message: ChatMessageDTO } | { ok: false; error: string }) => void,
  ) => void;
  'chat:typing': (roomId: string) => void;
  'trenches:subscribe': (chains: string[]) => void;
}

/** Deterministic room ids. */
export const roomIds = {
  world: () => 'world',
  /** Solana mints are case-sensitive; EVM addresses are normalised to lowercase. */
  coin: (chain: string, address: string) => `coin:${chain}:${chain === 'solana' ? address : address.toLowerCase()}`,
  channel: (channelId: string) => `channel:${channelId}`,
  dm: (a: string, b: string) => `dm:${[a, b].sort().join(':')}`,
  stream: (streamId: string) => `stream:${streamId}`,
};

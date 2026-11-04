import { env } from '../config';

/**
 * Thin client for Cloudflare Realtime (SFU). The browser does WebRTC directly with
 * Cloudflare; Magura's API only brokers sessions so the app token stays secret.
 */
const BASE = 'https://rtc.live.cloudflare.com/v1';

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface CfTrackRequest {
  location: 'local' | 'remote';
  mid?: string;
  trackName: string;
  sessionId?: string; // for remote tracks: the publisher's session
}

export function realtimeConfigured(): boolean {
  return !!(env.CF_REALTIME_APP_ID && env.CF_REALTIME_APP_TOKEN);
}

async function cf<T>(path: string, method: 'POST' | 'PUT' | 'GET', body?: unknown): Promise<T> {
  if (!realtimeConfigured()) throw new Error('cloudflare_realtime_not_configured');
  const res = await fetch(`${BASE}/apps/${env.CF_REALTIME_APP_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_REALTIME_APP_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { errorCode?: string; errorDescription?: string };
  if (!res.ok || json.errorCode) throw new Error(`cf_realtime: ${json.errorDescription ?? res.status}`);
  return json;
}

export const cfRealtime = {
  newSession: () => cf<{ sessionId: string }>('/sessions/new', 'POST'),

  newTracks: (sessionId: string, tracks: CfTrackRequest[], sessionDescription?: SessionDescription) =>
    cf<{ sessionDescription?: SessionDescription; requiresImmediateRenegotiation?: boolean; tracks: { mid: string; trackName: string; error?: unknown }[] }>(
      `/sessions/${sessionId}/tracks/new`,
      'POST',
      { sessionDescription, tracks },
    ),

  renegotiate: (sessionId: string, sessionDescription: SessionDescription) =>
    cf<unknown>(`/sessions/${sessionId}/renegotiate`, 'PUT', { sessionDescription }),

  closeTracks: (sessionId: string, mids: string[], sessionDescription?: SessionDescription) =>
    cf<{ sessionDescription?: SessionDescription }>(`/sessions/${sessionId}/tracks/close`, 'PUT', {
      tracks: mids.map((mid) => ({ mid })),
      sessionDescription,
      force: !sessionDescription,
    }),

  /** Short-lived TURN credentials so calls work behind strict NATs. */
  async iceServers(): Promise<RTCIceServer[]> {
    const stun: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    if (!env.CF_TURN_KEY_ID || !env.CF_TURN_KEY_TOKEN) return stun;
    const res = await fetch(`${BASE}/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_TURN_KEY_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (!res.ok) return stun;
    const json = (await res.json()) as { iceServers: RTCIceServer[] };
    return json.iceServers;
  },
};

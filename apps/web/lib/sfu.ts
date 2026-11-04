'use client';

import type { RtcTrack } from '@magura/shared';
import { api } from './api';

interface CfTracksResponse {
  sessionDescription?: RTCSessionDescriptionInit;
  requiresImmediateRenegotiation?: boolean;
  tracks?: { mid: string; trackName: string }[];
}

/**
 * One Cloudflare Realtime session = one RTCPeerConnection.
 * Publishes local tracks and pulls remote ones; every SDP exchange goes through
 * the Magura API so the Cloudflare app token never reaches the browser.
 */
export class SfuSession {
  readonly pc: RTCPeerConnection;
  private queue: Promise<unknown> = Promise.resolve();
  private midToTrack = new Map<string, RtcTrack>();
  private pulled = new Set<string>();
  private published = new Map<string, { mid: string; sender: RTCRtpSender }>();
  onRemoteTrack: (track: MediaStreamTrack, meta: RtcTrack) => void = () => {};

  constructor(
    readonly sessionId: string,
    iceServers: RTCIceServer[],
  ) {
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    this.pc.ontrack = (e) => {
      const mid = e.transceiver.mid;
      const meta = mid ? this.midToTrack.get(mid) : undefined;
      if (meta) this.onRemoteTrack(e.track, meta);
    };
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  publish(tracks: { track: MediaStreamTrack; name: string; kind: RtcTrack['kind'] }[]) {
    return this.run(async () => {
      const added = tracks.map((t) => ({ ...t, tr: this.pc.addTransceiver(t.track, { direction: 'sendonly' }) }));
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const res = await api<CfTracksResponse>(`/rtc/sessions/${this.sessionId}/publish`, {
        body: {
          offer: { type: 'offer', sdp: this.pc.localDescription!.sdp },
          tracks: added.map((a) => ({ mid: a.tr.mid!, trackName: a.name, kind: a.kind })),
        },
      });
      if (res.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription);
      for (const a of added) this.published.set(a.name, { mid: a.tr.mid!, sender: a.tr.sender });
    });
  }

  pull(tracks: RtcTrack[]) {
    return this.run(async () => {
      const fresh = tracks.filter((t) => !this.pulled.has(`${t.sessionId}:${t.trackName}`) && t.sessionId !== this.sessionId);
      if (!fresh.length) return;
      fresh.forEach((t) => this.pulled.add(`${t.sessionId}:${t.trackName}`));
      const res = await api<CfTracksResponse>(`/rtc/sessions/${this.sessionId}/pull`, {
        body: { tracks: fresh.map((t) => ({ sessionId: t.sessionId, trackName: t.trackName })) },
      });
      for (const r of res.tracks ?? []) {
        const meta = fresh.find((t) => t.trackName === r.trackName);
        if (meta && r.mid) this.midToTrack.set(r.mid, meta);
      }
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await this.pc.setRemoteDescription(res.sessionDescription);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await api(`/rtc/sessions/${this.sessionId}/renegotiate`, { body: { answer: { type: 'answer', sdp: this.pc.localDescription!.sdp } } });
      }
    });
  }

  unpublish(name: string) {
    return this.run(async () => {
      const p = this.published.get(name);
      if (!p) return;
      const tr = this.pc.getTransceivers().find((t) => t.mid === p.mid);
      tr?.stop();
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const res = await api<CfTracksResponse>(`/rtc/sessions/${this.sessionId}/close`, {
        body: { mids: [p.mid], trackNames: [name], offer: { type: 'offer', sdp: this.pc.localDescription!.sdp } },
      });
      if (res.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription);
      this.published.delete(name);
    });
  }

  close() {
    this.pc.getSenders().forEach((s) => s.track?.stop());
    this.pc.close();
  }
}

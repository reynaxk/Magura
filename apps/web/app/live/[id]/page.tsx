'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';
import { roomIds, type RtcTrack } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { SfuSession } from '@/lib/sfu';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { ChatPanel } from '@/components/chat-panel';
import { MediaTile } from '@/components/media-tile';
import { toast } from '@/components/toaster';
import { Avatar } from '@/components/ui';

interface StreamInfo {
  id: string;
  title: string;
  hostId: string;
  viewers: number;
  host: { handle: string; displayName: string | null; avatarUrl: string | null };
}

export default function StreamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useSession();
  const socket = useSocket();
  const router = useRouter();
  const sfu = useRef<SfuSession | null>(null);
  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [tracks, setTracks] = useState<{ audio?: MediaStreamTrack; video?: MediaStreamTrack; screen?: MediaStreamTrack }>({});
  const [isHost, setIsHost] = useState(false);
  const [offline, setOffline] = useState(false);

  // join the stream's socket room so we get track updates and chat
  useEffect(() => {
    socket?.emit('room:join', roomIds.stream(id));
  }, [socket, id]);

  useEffect(() => {
    let stop = false;
    const hostRaw = sessionStorage.getItem(`magura:host:${id}`);
    (async () => {
      try {
        if (hostRaw && me) {
          // host: publish camera + chart (screen)
          const { sessionId, iceServers } = JSON.parse(hostRaw) as { sessionId: string; iceServers: RTCIceServer[] };
          setIsHost(true);
          const s = new SfuSession(sessionId, iceServers);
          sfu.current = s;
          const cam = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
          const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 } }).catch(() => null);
          if (stop) return;
          const out: { track: MediaStreamTrack; name: string; kind: RtcTrack['kind'] }[] = [{ track: cam.getAudioTracks()[0], name: 'audio', kind: 'audio' }];
          const v = cam.getVideoTracks()[0];
          if (v) out.push({ track: v, name: 'cam', kind: 'video' });
          const sc = screen?.getVideoTracks()[0];
          if (sc) out.push({ track: sc, name: 'screen', kind: 'screen' });
          await s.publish(out);
          setTracks({ video: v, screen: sc });
          const streams = await api<StreamInfo[]>('/streams');
          setInfo(streams.find((x) => x.id === id) ?? null);
        } else {
          const w = await api<{ stream: StreamInfo; sessionId: string; iceServers: RTCIceServer[]; tracks: RtcTrack[] }>(`/streams/${id}/watch`, { method: 'POST' });
          if (stop) return;
          setInfo(w.stream);
          const s = new SfuSession(w.sessionId, w.iceServers);
          sfu.current = s;
          s.onRemoteTrack = (track, meta) => setTracks((t) => ({ ...t, [meta.kind]: track }));
          await s.pull(w.tracks);
        }
      } catch (e) {
        setOffline(true);
        toast({ title: 'Stream unavailable', body: (e as Error).message.replace(/_/g, ' ') });
      }
    })();
    return () => {
      stop = true;
      sfu.current?.close();
    };
  }, [id, me]);

  useSocketEvent('rtc:tracks', (p) => {
    if (p.scope !== `stream:${id}`) return;
    if (!p.tracks.length && !isHost) setOffline(true);
    else if (!isHost) void sfu.current?.pull(p.tracks);
  });

  async function end() {
    await api(`/streams/${id}/end`, { method: 'POST' });
    sessionStorage.removeItem(`magura:host:${id}`);
    router.push('/live');
  }

  const main = tracks.screen ?? tracks.video ?? null;

  return (
    <div className="flex min-h-app flex-wrap gap-4 p-5">
      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
        <div className="relative">
          {offline ? (
            <div className="flex aspect-video items-center justify-center rounded-[20px] border border-line bg-bar text-sm text-muted">This stream is offline</div>
          ) : (
            <MediaTile name={info?.host.handle ?? '…'} video={main} audio={isHost ? null : tracks.audio} label={info?.title} big />
          )}
          {!offline && <span className="absolute left-4 top-4 rounded-md bg-live px-2 py-0.5 text-[11px] font-semibold text-white">LIVE</span>}
          {tracks.screen && tracks.video && (
            <div className="absolute bottom-4 left-4 w-[200px]">
              <MediaTile name={info?.host.handle ?? ''} video={tracks.video} label="Cam" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 px-1">
          <Avatar name={info?.host.handle ?? '?'} src={info?.host.avatarUrl} size={52} />
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">{info?.title ?? 'Loading…'}</h1>
            <span className="text-[13px] text-muted">
              @{info?.host.handle} · {info?.viewers ?? 0} watching
            </span>
          </div>
          <div className="ml-auto flex gap-2">
            {isHost ? (
              <button className="btn-danger" onClick={end}>
                End stream
              </button>
            ) : (
              info && (
                <>
                  <a href={`/u/${info.host.handle}#copy`} className="btn-lime">
                    Copy @{info.host.handle}
                  </a>
                  <a href={`/u/${info.host.handle}`} className="btn-ghost">
                    Profile
                  </a>
                </>
              )
            )}
          </div>
        </div>
      </div>
      <aside className="panel flex max-h-[calc(100vh-104px)] min-w-0 flex-[1_1_340px] flex-col overflow-hidden lg:max-w-[400px]">
        <ChatPanel roomId={roomIds.stream(id)} title="Stream chat" subtitle={me ? undefined : 'read-only until you log in'} className="min-h-0 flex-1" />
      </aside>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';
import type { RtcTrack } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { SfuSession } from '@/lib/sfu';
import { useSocketEvent } from '@/lib/socket';
import { MediaTile } from '@/components/media-tile';
import { toast } from '@/components/toaster';
import { Empty, Icon, Svg } from '@/components/ui';

interface Remote {
  userId: string;
  handle: string;
  audio?: MediaStreamTrack;
  video?: MediaStreamTrack;
  screen?: MediaStreamTrack;
}

export default function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, login } = useSession();
  const router = useRouter();
  const sfu = useRef<SfuSession | null>(null);
  const local = useRef<MediaStream | null>(null);
  const [localVideo, setLocalVideo] = useState<MediaStreamTrack | null>(null);
  const [remotes, setRemotes] = useState<Record<string, Remote>>({});
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [state, setState] = useState<'joining' | 'live' | 'error' | 'ended'>('joining');

  useEffect(() => {
    if (!me) return;
    let closed = false;
    (async () => {
      try {
        const join = await api<{ sessionId: string; iceServers: RTCIceServer[]; tracks: RtcTrack[] }>(`/calls/${id}/join`, { method: 'POST' });
        if (closed) return;
        const s = new SfuSession(join.sessionId, join.iceServers);
        sfu.current = s;
        s.onRemoteTrack = (track, meta) =>
          setRemotes((r) => ({ ...r, [meta.userId]: { ...(r[meta.userId] ?? { userId: meta.userId, handle: meta.handle }), [meta.kind]: track } }));
        let media: MediaStream;
        try {
          media = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 1280, height: 720 } });
        } catch {
          media = await navigator.mediaDevices.getUserMedia({ audio: true });
          setCam(false);
        }
        local.current = media;
        const v = media.getVideoTracks()[0] ?? null;
        setLocalVideo(v);
        await s.publish([
          { track: media.getAudioTracks()[0], name: `${me.id}-audio`, kind: 'audio' },
          ...(v ? [{ track: v, name: `${me.id}-video`, kind: 'video' as const }] : []),
        ]);
        await s.pull(join.tracks.filter((t) => t.userId !== me.id));
        setState('live');
      } catch (e) {
        setState('error');
        toast({ title: "Couldn't join the call", body: (e as Error).message.replace(/_/g, ' ') });
      }
    })();
    return () => {
      closed = true;
      sfu.current?.close();
      local.current?.getTracks().forEach((t) => t.stop());
      void api(`/calls/${id}/leave`, { method: 'POST' }).catch(() => undefined);
    };
  }, [id, me]);

  useSocketEvent('rtc:tracks', (p) => {
    if (p.scope !== `call:${id}` || !me) return;
    const present = new Set(p.tracks.map((t) => t.userId));
    setRemotes((r) => Object.fromEntries(Object.entries(r).filter(([uid]) => present.has(uid))));
    void sfu.current?.pull(p.tracks.filter((t) => t.userId !== me.id));
  });
  useSocketEvent('call:ended', (p) => p.callId === id && setState('ended'));

  async function toggleScreen() {
    if (!sfu.current || !me) return;
    if (sharing) {
      await sfu.current.unpublish(`${me.id}-screen`);
      setSharing(false);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      track.onended = () => {
        void sfu.current?.unpublish(`${me.id}-screen`);
        setSharing(false);
      };
      await sfu.current.publish([{ track, name: `${me.id}-screen`, kind: 'screen' }]);
      setSharing(true);
    } catch {
      /* user cancelled */
    }
  }

  if (!me)
    return (
      <Empty icon={Icon.phone} title="Log in to join the call">
        <button className="btn-lime mt-3" onClick={login}>
          Log in
        </button>
      </Empty>
    );
  if (state === 'ended') return <Empty icon={Icon.end} title="Call ended" />;

  const people = Object.values(remotes);
  const screen = people.find((p) => p.screen);
  const controls = [
    {
      label: mic ? 'Mute' : 'Unmute',
      d: Icon.mic,
      on: mic,
      fn: () => {
        local.current?.getAudioTracks().forEach((t) => (t.enabled = !mic));
        setMic(!mic);
      },
    },
    {
      label: cam ? 'Camera off' : 'Camera on',
      d: Icon.video,
      on: cam,
      fn: () => {
        local.current?.getVideoTracks().forEach((t) => (t.enabled = !cam));
        setCam(!cam);
      },
    },
    { label: sharing ? 'Stop sharing' : 'Share screen or chart', d: Icon.screen, on: sharing, fn: toggleScreen },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[22px] font-semibold">Call</h1>
        <span className="rounded-full border border-violet-line bg-violet-dim px-2.5 py-0.5 text-xs text-violet-2">
          {state === 'joining' ? 'Connecting…' : `${people.length + 1} in call`}
        </span>
      </div>
      {screen?.screen && <MediaTile name={screen.handle} video={screen.screen} label={`${screen.handle} · sharing`} big />}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        <MediaTile name={me.handle} video={cam ? localVideo : null} label="You" muted />
        {people.map((p) => (
          <MediaTile key={p.userId} name={p.handle} video={p.video} audio={p.audio} />
        ))}
      </div>
      <div className="flex items-center justify-center gap-3 pt-2">
        {controls.map((c) => (
          <button
            key={c.label}
            aria-label={c.label}
            aria-pressed={c.on}
            onClick={c.fn}
            className={`flex h-14 w-14 items-center justify-center rounded-full ${c.on ? 'bg-raised text-text' : 'bg-text text-bg'} border border-line-3`}
          >
            <Svg d={c.d} size={22} />
          </button>
        ))}
        <button aria-label="Leave call" onClick={() => router.back()} className="flex h-14 w-14 items-center justify-center rounded-full bg-live text-white">
          <Svg d={Icon.end} size={22} />
        </button>
      </div>
    </div>
  );
}

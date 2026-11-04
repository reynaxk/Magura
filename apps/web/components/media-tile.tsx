'use client';

import { useEffect, useRef } from 'react';
import { Avatar } from './ui';

/** A participant tile: video when available, otherwise an avatar. Audio plays through a hidden element. */
export function MediaTile({
  name,
  video,
  audio,
  muted,
  speaking,
  label,
  big,
}: {
  name: string;
  video?: MediaStreamTrack | null;
  audio?: MediaStreamTrack | null;
  muted?: boolean;
  speaking?: boolean;
  label?: string;
  big?: boolean;
}) {
  const vRef = useRef<HTMLVideoElement>(null);
  const aRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (vRef.current) vRef.current.srcObject = video ? new MediaStream([video]) : null;
  }, [video]);
  useEffect(() => {
    if (aRef.current) aRef.current.srcObject = audio && !muted ? new MediaStream([audio]) : null;
  }, [audio, muted]);
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-2xl border-2 bg-raised ${speaking ? 'border-violet' : 'border-line-2'} ${big ? 'aspect-video' : 'aspect-[4/3]'}`}
    >
      {video ? (
        <video ref={vRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Avatar name={name} size={big ? 96 : 48} shape="circle" />
      )}
      <audio ref={aRef} autoPlay />
      <span className="absolute bottom-2 left-2.5 rounded-md bg-bg/70 px-1.5 py-0.5 text-[11px] text-text-2">{label ?? name}</span>
    </div>
  );
}

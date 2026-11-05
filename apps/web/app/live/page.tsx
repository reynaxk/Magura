'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SocialTabs } from '@/components/header';
import { useSession } from '@/lib/session';
import { toast } from '@/components/toaster';
import { Avatar, Empty, Icon } from '@/components/ui';

interface StreamRow {
  id: string;
  title: string;
  tags: string[];
  viewers: number;
  startedAt: string;
  host: { handle: string; displayName: string | null; avatarUrl: string | null };
}

export default function LivePage() {
  const { me, login } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  const streams = useQuery({ queryKey: ['streams'], queryFn: () => api<StreamRow[]>('/streams'), refetchInterval: 20_000 });
  const goLive = useMutation({
    mutationFn: () => api<{ stream: { id: string }; sessionId: string; iceServers: RTCIceServer[] }>('/streams', { body: { title } }),
    onSuccess: (r) => {
      sessionStorage.setItem(`magura:host:${r.stream.id}`, JSON.stringify({ sessionId: r.sessionId, iceServers: r.iceServers }));
      router.push(`/live/${r.stream.id}`);
    },
    onError: (e) => toast({ title: "Couldn't go live", body: (e as Error).message.replace(/_/g, ' ') }),
  });

  return (
    <>
    <SocialTabs />
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4 md:p-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] font-semibold tracking-tight">Live</h1>
        <span className="text-sm text-muted">Traders streaming their charts, entries and Q&A.</span>
        <button className="btn ml-auto bg-live text-white" onClick={() => (me ? setOpen(true) : login())}>
          <span className="h-2 w-2 rounded-full bg-white" /> Go live
        </button>
      </div>
      {open && (
        <form
          className="panel flex flex-wrap items-end gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            goLive.mutate();
          }}
        >
          <label className="flex min-w-[320px] flex-1 flex-col gap-1.5 text-xs text-muted">
            Stream title
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={100} placeholder="e.g. SOL ecosystem flows — live entries" />
          </label>
          <button className="btn h-11 bg-live text-white" disabled={goLive.isPending}>
            Start stream
          </button>
        </form>
      )}
      {streams.data?.length === 0 && <Empty icon={Icon.video} title="Nobody is live right now">Be the first — share your chart and trade with your followers.</Empty>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {streams.data?.map((s) => (
          <Link key={s.id} href={`/live/${s.id}`} className="card flex flex-col overflow-hidden hover:bg-hover">
            <div className="relative flex aspect-video items-center justify-center bg-raised">
              <Avatar name={s.host.handle} src={s.host.avatarUrl} size={64} shape="circle" ring="#E5354B" />
              <span className="absolute left-3 top-3 rounded-md bg-live px-2 py-0.5 text-[11px] font-semibold text-white">LIVE</span>
              <span className="num absolute bottom-3 right-3 rounded-md bg-bg/80 px-2 py-0.5 text-[11px]">{s.viewers} watching</span>
            </div>
            <div className="flex flex-col gap-1 p-4">
              <span className="font-semibold">{s.title}</span>
              <span className="text-xs text-muted">@{s.host.handle}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
    </>
  );
}

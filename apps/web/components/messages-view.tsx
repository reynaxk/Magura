'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSocketEvent } from '@/lib/socket';
import { ChatPanel } from './chat-panel';
import { toast } from './toaster';
import { Avatar, Empty, Icon, Svg } from './ui';

interface Convo {
  roomId: string;
  accepted: boolean;
  with?: { id: string; handle: string; displayName: string | null; avatarUrl: string | null };
  lastMessage: { text: string; from: string; at: string } | null;
  unread: number;
}

export function MessagesView({ roomId }: { roomId?: string }) {
  const { me, login } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread' | 'requests'>('all');
  const [to, setTo] = useState('');
  const convos = useQuery({ queryKey: ['dms'], queryFn: () => api<Convo[]>('/dms'), enabled: !!me, refetchInterval: 30_000 });
  useSocketEvent('chat:message', (m) => m.roomId.startsWith('dm:') && qc.invalidateQueries({ queryKey: ['dms'] }));

  const current = convos.data?.find((c) => c.roomId === roomId);
  useEffect(() => {
    if (roomId && me) api(`/dms/${encodeURIComponent(roomId)}/read`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['dms'] }));
  }, [roomId, me, qc]);

  const open = useMutation({
    mutationFn: (handle: string) => api<{ roomId: string }>(`/dms/with/${handle.replace(/^@/, '')}`, { method: 'POST' }),
    onSuccess: (r) => router.push(`/messages/${encodeURIComponent(r.roomId)}`),
    onError: () => toast({ title: 'User not found', body: 'Check the handle' }),
  });
  const call = useMutation({
    mutationFn: (video: boolean) => api<{ id: string }>('/calls', { body: { roomId, video } }),
    onSuccess: (c) => router.push(`/call/${c.id}`),
    onError: (e) => toast({ title: "Couldn't start call", body: (e as Error).message.replace(/_/g, ' ') }),
  });

  if (!me)
    return (
      <Empty title="Log in to see your messages">
        <button className="btn-lime mt-3" onClick={login}>
          Log in
        </button>
      </Empty>
    );

  const list = (convos.data ?? []).filter((c) => (filter === 'requests' ? !c.accepted : filter === 'unread' ? c.unread > 0 && c.accepted : c.accepted));

  return (
    <div className="flex h-[calc(100vh-64px)] flex-wrap">
      <aside aria-label="Conversations" className="flex w-full max-w-[360px] shrink-0 flex-col border-r border-line bg-bar">
        <div className="flex flex-col gap-3 p-4">
          <h1 className="text-[22px] font-semibold">Messages</h1>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (to.trim()) open.mutate(to.trim());
            }}
          >
            <label className="flex h-10 flex-1 items-center rounded-xl border border-line-2 bg-raised px-3">
              <span className="sr-only">New message to</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="New message: @handle" className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint" />
            </label>
            <button aria-label="Start conversation" className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-bg">
              <Svg d={Icon.plus} />
            </button>
          </form>
          <div role="tablist" aria-label="Filter" className="flex gap-1.5">
            {(['all', 'unread', 'requests'] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={filter === f ? 'chip-on' : 'chip'}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="scroll-thin flex flex-col gap-0.5 overflow-y-auto px-2 pb-3">
          {list.map((c) => (
            <Link key={c.roomId} href={`/messages/${encodeURIComponent(c.roomId)}`} className={`flex items-center gap-3 rounded-[14px] p-2.5 ${c.roomId === roomId ? 'bg-hover' : 'hover:bg-panel'}`}>
              <Avatar name={c.with?.handle ?? '?'} src={c.with?.avatarUrl} size={44} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{c.with?.displayName ?? c.with?.handle}</span>
                  {c.lastMessage && <span className="ml-auto text-[11px] text-faint">{new Date(c.lastMessage.at).toLocaleDateString()}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`truncate text-xs ${c.unread ? 'text-text' : 'text-muted'}`}>{c.lastMessage ? `${c.lastMessage.from === me.handle ? 'You: ' : ''}${c.lastMessage.text}` : 'No messages yet'}</span>
                  {c.unread > 0 && <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-lime px-1 text-[10px] font-semibold text-bg">{c.unread}</span>}
                </span>
              </span>
            </Link>
          ))}
          {convos.data && list.length === 0 && <p className="p-6 text-center text-sm text-muted">Nothing here</p>}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {roomId && current ? (
          <>
            <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
              <Avatar name={current.with?.handle ?? '?'} src={current.with?.avatarUrl} size={40} />
              <Link href={`/u/${current.with?.handle}`} className="flex flex-col">
                <span className="font-semibold">{current.with?.displayName ?? current.with?.handle}</span>
                <span className="text-xs text-muted">@{current.with?.handle}</span>
              </Link>
              <div className="ml-auto flex gap-2">
                {!current.accepted && (
                  <button className="btn-lime h-10" onClick={() => api(`/dms/${encodeURIComponent(roomId)}/accept`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['dms'] }))}>
                    Accept request
                  </button>
                )}
                <button aria-label="Voice call" onClick={() => call.mutate(false)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line-2 bg-raised hover:bg-hover">
                  <Svg d={Icon.phone} />
                </button>
                <button aria-label="Video call" onClick={() => call.mutate(true)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet text-bar">
                  <Svg d={Icon.video} />
                </button>
              </div>
            </div>
            <ChatPanel key={roomId} roomId={roomId} header={false} placeholder={`Message ${current.with?.handle}`} className="min-h-0 flex-1 pt-4" />
          </>
        ) : (
          <Empty title={roomId ? 'Conversation not found' : 'Pick a conversation'}>Share trades, voice notes and jump on a call from any DM.</Empty>
        )}
      </main>
    </div>
  );
}

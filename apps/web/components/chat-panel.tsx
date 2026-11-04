'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessageDTO } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { Avatar, Icon, LiveDot, Svg } from './ui';
import { toast } from './toaster';

function TradeCard({ a }: { a: Extract<ChatMessageDTO['attachment'], { kind: 'trade' }> }) {
  const buy = a.side === 'buy';
  return (
    <div className="mt-1 flex items-center gap-2.5 rounded-xl border border-line-2 bg-raised px-3 py-2">
      <span className={`num text-xs font-semibold ${buy ? 'text-lime' : 'text-down'}`}>
        {buy ? 'BOUGHT' : 'SOLD'} {a.pct && !buy ? `${a.pct}% ` : ''}
        {a.token.symbol}
        {a.amountUsd ? ` · $${a.amountUsd.toFixed(0)}` : ''}
      </span>
      <Link href={`/t/${a.chain}/${a.token.address}`} className="ml-auto rounded-lg bg-text px-2.5 py-1 text-[11px] font-semibold text-bg">
        {buy ? 'Copy trade' : 'Open'}
      </Link>
    </div>
  );
}

function CallCard({ a }: { a: Extract<ChatMessageDTO['attachment'], { kind: 'call' }> }) {
  return (
    <div className="mt-1 flex max-w-md flex-col gap-2.5 rounded-2xl border border-lime-line bg-panel p-3.5">
      <div className="flex items-center gap-2">
        <span className="rounded-[5px] bg-lime px-1.5 py-0.5 text-[10px] font-semibold text-bg">CALL</span>
        <span className="num text-[15px] font-semibold">{a.token.symbol}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        {[
          ['Buy zone', a.buyZone],
          ['Target', a.target],
          ['Invalid below', a.invalidation],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <span className="text-muted">{k}</span>
            <span className="num">{v}</span>
          </div>
        ))}
      </div>
      <Link href={`/t/${a.chain}/${a.token.address}`} className="btn-lime h-9 self-start text-xs">
        Open & buy
      </Link>
    </div>
  );
}

export function ChatMessages({ messages, dense }: { messages: ChatMessageDTO[]; dense?: boolean }) {
  return (
    <>
      {messages.map((m) => (
        <div key={m.id} className="flex gap-2.5">
          <Link href={`/u/${m.author.handle}`} className="shrink-0">
            <Avatar name={m.author.handle} src={m.author.avatarUrl} size={dense ? 28 : 32} />
          </Link>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <Link href={`/u/${m.author.handle}`} className="text-[13px] font-semibold hover:underline">
                {m.author.handle}
              </Link>
              {m.author.badges.includes('TOP_1') && <span className="rounded border border-violet-line px-1 text-[10px] text-violet">TOP 1%</span>}
              <span className="text-[11px] text-faint">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {m.text && <span className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-2">{m.text}</span>}
            {m.attachment?.kind === 'trade' && <TradeCard a={m.attachment} />}
            {m.attachment?.kind === 'call' && <CallCard a={m.attachment} />}
          </div>
        </div>
      ))}
    </>
  );
}

/** Live chat for any room: coin rooms, world chat, group channels, DMs and streams. */
export function ChatPanel({
  roomId,
  title,
  subtitle,
  placeholder = 'Say something',
  actions,
  header = true,
  className = '',
}: {
  roomId: string;
  title?: ReactNode;
  subtitle?: string;
  placeholder?: string;
  actions?: ReactNode;
  header?: boolean;
  className?: string;
}) {
  const socket = useSocket();
  const { me, login } = useSession();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [online, setOnline] = useState<number | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const key = ['room', roomId];

  const history = useQuery({ queryKey: key, queryFn: () => api<ChatMessageDTO[]>(`/rooms/${encodeURIComponent(roomId)}/messages`) });

  useEffect(() => {
    if (!socket) return;
    socket.emit('room:join', roomId);
    return () => {
      socket.emit('room:leave', roomId);
    };
  }, [socket, roomId]);

  useSocketEvent('chat:message', (m) => {
    if (m.roomId !== roomId) return;
    qc.setQueryData<ChatMessageDTO[]>(key, (xs = []) => (xs.some((x) => x.id === m.id) ? xs : [...xs.slice(-199), m]));
  });
  useSocketEvent('chat:presence', (p) => p.roomId === roomId && setOnline(p.online));
  useSocketEvent('chat:typing', (p) => {
    if (p.roomId !== roomId || p.userId === me?.id) return;
    setTyping(p.handle);
    setTimeout(() => setTyping(null), 2500);
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [history.data?.length]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    if (!me) return login();
    setText('');
    const res = await socket?.emitWithAck('chat:send', { roomId, text: t });
    if (res && !res.ok) {
      setText(t);
      toast({ title: "Couldn't send", body: res.error.replace(/_/g, ' ') });
    }
  }

  return (
    <section aria-label="Chat" className={`flex min-h-0 flex-col ${className}`}>
      {header && (
        <div className="flex items-center gap-2.5 px-4 py-3">
          <LiveDot />
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs text-muted">{online != null ? `${online} online` : subtitle}</span>
          <span className="ml-auto flex gap-2">{actions}</span>
        </div>
      )}
      <div ref={listRef} className="scroll-thin flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 pb-4">
        {history.isLoading && <span className="text-xs text-muted">Loading…</span>}
        {history.data?.length === 0 && <span className="py-8 text-center text-xs text-muted">No messages yet. Start the room.</span>}
        <ChatMessages messages={history.data ?? []} />
      </div>
      {typing && <span className="px-4 pb-1 text-[11px] text-faint">{typing} is typing…</span>}
      <form
        className="flex items-center gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="flex h-11 flex-1 items-center rounded-xl border border-line-2 bg-raised px-3">
          <span className="sr-only">Message</span>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              socket?.emit('chat:typing', roomId);
            }}
            placeholder={me ? placeholder : 'Log in to chat'}
            maxLength={1000}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
        </label>
        <button type="submit" aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime text-bg">
          <Svg d={Icon.send} />
        </button>
      </form>
    </section>
  );
}

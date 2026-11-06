'use client';

import { useState } from 'react';
import { roomIds, type ChainId } from '@magura/shared';
import { useSession } from '@/lib/session';
import { useSocket } from '@/lib/socket';
import { toast } from './toaster';

/** "Make a callout": post your thesis into the coin's room right where you trade. */
export function CalloutBox({ chain, token, symbol }: { chain: ChainId; token: string; symbol: string }) {
  const { me, login } = useSession();
  const socket = useSocket();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!me) return login();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const res = (await socket?.emitWithAck('chat:send', { roomId: roomIds.coin(chain, token), text: `📣 $${symbol}: ${t}` })) as { error?: string } | undefined;
    setBusy(false);
    if (res?.error) return toast({ title: "Couldn't post", body: res.error.replace(/_/g, ' ') });
    setText('');
    toast({ title: 'Callout posted', body: `Everyone in the $${symbol} room sees it with your live PnL`, tone: 'lime' });
  };
  return (
    <form
      className="flex flex-col gap-1.5 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void post();
      }}
    >
      <span className="label">Make a callout</span>
      <div className="flex gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center rounded-xl border border-line-2 bg-raised px-3 focus-within:border-lime-line">
          <span className="sr-only">Your callout</span>
          <input value={text} maxLength={240} onChange={(e) => setText(e.target.value)} placeholder={`Why ${symbol}? Your thesis…`} className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </label>
        <button disabled={busy || !text.trim()} className="h-10 shrink-0 rounded-xl bg-text px-3.5 text-xs font-semibold text-bg disabled:opacity-40">
          Post
        </button>
      </div>
    </form>
  );
}

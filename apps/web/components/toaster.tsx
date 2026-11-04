'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';

interface Toast {
  id: string;
  title: string;
  body: string;
  href?: string | null;
  tone?: 'default' | 'lime' | 'violet';
}

let push: (t: Omit<Toast, 'id'>) => void = () => {};
export function toast(t: Omit<Toast, 'id'>) {
  push(t);
}

/** Global toasts + realtime notifications (copy confirms, incoming calls, going live). */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  const qc = useQueryClient();
  push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 6000);
  }, []);

  useSocketEvent('notification', (n) => {
    push({ title: n.title, body: n.body, href: n.href });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  });
  useSocketEvent('copy:confirm', (p) => {
    push({ title: `Confirm copy of @${p.leader}`, body: `${p.side} ${p.symbol} · ~$${p.amountUsd.toFixed(0)}`, href: '/portfolio', tone: 'lime' });
    qc.invalidateQueries({ queryKey: ['copy-pending'] });
  });
  useSocketEvent('copy:executed', (p) => push({ title: 'Copied', body: `${p.side} ${p.symbol} · $${p.amountUsd.toFixed(0)}`, tone: 'lime' }));
  useSocketEvent('call:ring', (p) => push({ title: `@${p.from.handle} is calling`, body: p.video ? 'Video call' : 'Voice call', href: `/call/${p.callId}`, tone: 'violet' }));
  useSocketEvent('stream:live', (p) => push({ title: `@${p.hostHandle} is live`, body: p.title, href: `/live/${p.streamId}`, tone: 'violet' }));

  return (
    <div aria-live="polite" className="fixed bottom-6 right-6 z-50 flex w-[340px] flex-col gap-2">
      {items.map((t) => {
        const border = t.tone === 'lime' ? 'border-lime-line' : t.tone === 'violet' ? 'border-violet-line' : 'border-line-3';
        const inner = (
          <div className={`panel flex flex-col gap-1 border ${border} p-4`}>
            <span className="text-sm font-semibold">{t.title}</span>
            <span className="text-[13px] text-muted">{t.body}</span>
          </div>
        );
        return t.href ? (
          <Link key={t.id} href={t.href}>
            {inner}
          </Link>
        ) : (
          <div key={t.id}>{inner}</div>
        );
      })}
    </div>
  );
}

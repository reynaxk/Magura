'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { soundFor } from '@/lib/sounds';
import { readUiPrefs, useApplyTheme, useUiPrefs, type SoundEvent } from '@/lib/ui-prefs';

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
const NOTIF_SOUND: Record<string, SoundEvent> = { order: 'order', alert: 'alert', price: 'alert', friend_buy: 'friend', follow_buy: 'friend', mention: 'mention', dm: 'mention' };
const POS = {
  'top-right': 'md:bottom-auto md:right-6 md:top-20',
  'top-center': 'md:bottom-auto md:left-1/2 md:top-20 md:-translate-x-1/2',
  'bottom-right': 'md:right-6 md:bottom-10',
  'bottom-left': 'md:left-6 md:bottom-10',
} as const;

export function Toaster() {
  useApplyTheme();
  const [ui] = useUiPrefs();
  const [items, setItems] = useState<Toast[]>([]);
  const qc = useQueryClient();
  push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    const max = Math.max(1, readUiPrefs().maxToasts);
    setItems((xs) => [...xs.slice(-(max - 1)), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 6000);
  }, []);

  useSocketEvent('notification', (n) => {
    push({ title: n.title, body: n.body, href: n.href });
    const ev = NOTIF_SOUND[n.kind] ?? (/friend|follow/.test(n.kind) ? 'friend' : null);
    if (ev) soundFor(ev);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  });
  useSocketEvent('coin:devsell', () => soundFor('devsell'));
  useSocketEvent('copy:confirm', (p) => {
    push({ title: `Confirm copy of @${p.leader}`, body: `${p.side} ${p.symbol} · ~$${p.amountUsd.toFixed(0)}`, href: '/portfolio', tone: 'lime' });
    qc.invalidateQueries({ queryKey: ['copy-pending'] });
  });
  useSocketEvent('order:fired', (p) => {
    const name =
      (
        {
          tp: 'Take profit',
          sl: 'Stop loss',
          trail: 'Trailing stop',
          trail_tp: 'Trailing take profit',
          limit_buy: 'Limit buy',
          dca: 'DCA buy',
          dev_sell: 'Dev sold — selling',
          dev_sell_buy: 'Dev sold — buying',
          migrate_buy: 'Migrated — buying',
          migrate_sell: 'Migrated — selling',
        } as Record<string, string>
      )[p.kind] ?? 'Order';
    soundFor('order');
    push(
      p.needsConfirm
        ? { title: `${name} hit on ${p.symbol}`, body: 'Tap to confirm the trade', href: `/t/${p.chain}/${p.token}`, tone: 'lime' }
        : { title: `${name} filled on ${p.symbol}`, body: p.side === 'sell' ? 'Sold — confirming on-chain' : 'Bought — confirming on-chain', tone: 'lime' },
    );
    qc.invalidateQueries({ queryKey: ['orders'] });
  });
  useSocketEvent('copy:executed', (p) => push({ title: 'Copied', body: `${p.side} ${p.symbol} · $${p.amountUsd.toFixed(0)}`, tone: 'lime' }));
  useSocketEvent('call:ring', (p) => push({ title: `@${p.from.handle} is calling`, body: p.video ? 'Video call' : 'Voice call', href: `/call/${p.callId}`, tone: 'violet' }));
  useSocketEvent('stream:live', (p) => push({ title: `@${p.hostHandle} is live`, body: p.title, href: `/live/${p.streamId}`, tone: 'violet' }));

  return (
    <div aria-live="polite" className={`fixed inset-x-3 bottom-24 z-50 flex flex-col gap-2 md:inset-x-auto md:w-[340px] ${POS[ui.toastPosition]}`}>
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

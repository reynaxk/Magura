'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

/** Browser / phone push: register the service worker and subscribe this device. */
export function usePush() {
  const [state, setState] = useState<PushState>('off');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('denied');
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? 'on' : 'off');
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    void check();
  }, [check]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const { publicKey } = await api<{ publicKey: string | null }>('/notifications/vapid');
      if (!publicKey) return setState('unavailable');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState(perm === 'denied' ? 'denied' : 'off');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api('/notifications/push-subscriptions', { body: { endpoint: j.endpoint, keys: j.keys } });
      setState('on');
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
    setState('off');
  }, []);

  return { state, busy, enable, disable };
}

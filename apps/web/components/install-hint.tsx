'use client';

import { useEffect, useState } from 'react';
import { usePref } from '@/lib/prefs';

type BIPEvent = Event & { prompt: () => Promise<void> };

/** Phone-only, dismissible: add Magura to the home screen (needed on iPhone for push). */
export function InstallHint() {
  const [dismissed, setDismissed] = usePref<boolean>('install-dismissed', false);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [evt, setEvt] = useState<BIPEvent | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setShow(!standalone && mobile);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!show || dismissed || (!ios && !evt)) return null;
  return (
    <div className="fixed inset-x-3 bottom-[84px] z-30 flex items-center gap-3 rounded-2xl border border-line-3 bg-raised p-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)] md:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" width={36} height={36} className="rounded-[10px]" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-semibold">Get the Magura app</span>
        <span className="text-[11px] text-muted">{ios ? 'Tap Share, then “Add to Home Screen”' : 'Install for alerts and one-tap access'}</span>
      </span>
      {evt && (
        <button className="btn-lime h-8 px-3 text-xs" onClick={() => evt.prompt().then(() => setDismissed(true))}>
          Install
        </button>
      )}
      <button aria-label="Dismiss" onClick={() => setDismissed(true)} className="px-1 text-sm text-muted">
        ✕
      </button>
    </div>
  );
}

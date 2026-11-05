'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Right-side sheet for the intercepted coin route. Esc or the backdrop closes it. */
export function CoinDrawer({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const open = path === href || path?.startsWith('/t/');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && router.back();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, router]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close coin" onClick={() => router.back()} className="hidden flex-1 bg-black/55 backdrop-blur-[2px] md:block" />
      <div role="dialog" aria-modal="true" aria-label="Coin" className="scroll-thin relative h-full w-full overflow-y-auto border-l border-line-3 bg-bg shadow-[-24px_0_60px_rgba(0,0,0,0.5)] md:w-[min(1180px,92vw)]">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bar/95 px-4 py-2 backdrop-blur">
          <button onClick={() => router.back()} className="num flex h-8 items-center gap-1.5 rounded-lg border border-line-2 px-2.5 text-[11px] text-muted hover:text-text">
            Esc · Close
          </button>
          <a href={href} className="ml-auto text-xs text-muted hover:text-text">
            Open full page ↗
          </a>
        </div>
        {children}
      </div>
    </div>
  );
}

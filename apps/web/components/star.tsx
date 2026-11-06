'use client';

import { useWatchlist } from '@/lib/watchlist';

/** Watchlist star. */
export function Star({ chain, address, size = 14 }: { chain: string; address: string; size?: number }) {
  const w = useWatchlist();
  const on = w.has(chain, address);
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        w.toggle(chain, address);
      }}
      aria-pressed={on}
      aria-label={on ? 'Remove from watchlist' : 'Add to watchlist'}
      className={`shrink-0 ${on ? 'text-amber' : 'text-faint hover:text-text-2'}`}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
      </svg>
    </button>
  );
}

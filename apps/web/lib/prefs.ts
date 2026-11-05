'use client';

import { useEffect, useState } from 'react';

/** A tiny localStorage-backed preference, safe on the server and in private mode. */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`magura:${key}`);
      if (raw != null) setV(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);
  const set = (next: T) => {
    setV(next);
    try {
      localStorage.setItem(`magura:${key}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return [v, set];
}

export type Density = 'comfortable' | 'compact';
export const useDensity = () => usePref<Density>('density', 'comfortable');

'use client';

import { useEffect } from 'react';
import { usePref } from './prefs';

/** Theme presets. Each one overrides the design tokens in globals.css. */
export const THEMES = [
  { id: 'magura', label: 'Magura', swatch: ['#08090C', '#12151B', '#2FE39A'] },
  { id: 'oled', label: 'OLED black', swatch: ['#000000', '#0A0A0A', '#2FE39A'] },
  { id: 'midnight', label: 'Midnight', swatch: ['#070B14', '#101828', '#5B8CFF'] },
  { id: 'graphite', label: 'Graphite', swatch: ['#111214', '#1B1D21', '#E9ECF2'] },
  { id: 'ember', label: 'Ember', swatch: ['#0C0907', '#1A1310', '#FF8A3D'] },
  { id: 'violet', label: 'Violet', swatch: ['#0A0812', '#16121F', '#A78BFA'] },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

export const ACCENTS = ['#2FE39A', '#5B8CFF', '#A78BFA', '#FF8A3D', '#F2D15C', '#FF5C9A', '#E9ECF2'] as const;

export const SOUND_EVENTS = [
  { id: 'buy', label: 'Your buys' },
  { id: 'sell', label: 'Your sells' },
  { id: 'order', label: 'Orders & automations fire' },
  { id: 'alert', label: 'Price alerts' },
  { id: 'friend', label: 'Friends buy' },
  { id: 'devsell', label: 'Dev sells a coin you watch' },
  { id: 'mention', label: 'Mentions & DMs' },
] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number]['id'];
export const SOUNDS = ['off', 'tick', 'pop', 'chime', 'kaching', 'bell', 'blip'] as const;
export type SoundId = (typeof SOUNDS)[number];

export interface UiPrefs {
  /** pro = dense terminal: compact rows, always-open sidebar, dock windows */
  layout: 'clean' | 'pro';
  theme: ThemeId;
  /** null = the theme's own accent */
  accent: string | null;
  sounds: Record<SoundEvent, SoundId>;
  volume: number;
  toastPosition: 'top-right' | 'top-center' | 'bottom-right' | 'bottom-left';
  maxToasts: number;
}

export const DEFAULT_UI: UiPrefs = {
  layout: 'clean',
  theme: 'magura',
  accent: null,
  sounds: { buy: 'tick', sell: 'kaching', order: 'chime', alert: 'bell', friend: 'pop', devsell: 'blip', mention: 'pop' },
  volume: 0.6,
  toastPosition: 'top-right',
  maxToasts: 4,
};

export function useUiPrefs(): [UiPrefs, (p: UiPrefs) => void] {
  const [p, set] = usePref<UiPrefs>('ui-prefs', DEFAULT_UI);
  return [{ ...DEFAULT_UI, ...p, sounds: { ...DEFAULT_UI.sounds, ...(p.sounds ?? {}) } }, set];
}

/** Read prefs outside React (sound player, toaster). */
export function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem('magura:ui-prefs');
    const p = raw ? (JSON.parse(raw) as Partial<UiPrefs>) : {};
    return { ...DEFAULT_UI, ...p, sounds: { ...DEFAULT_UI.sounds, ...(p.sounds ?? {}) } };
  } catch {
    return DEFAULT_UI;
  }
}

const hexToRgb = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Puts the theme on <html> and the accent into the --color-lime tokens. */
export function useApplyTheme() {
  const [p] = useUiPrefs();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = p.theme;
    const accent = p.accent ?? (THEMES.find((t) => t.id === p.theme)?.swatch[2] as string);
    const [r, g, b] = hexToRgb(accent);
    root.style.setProperty('--color-lime', accent);
    root.style.setProperty('--color-lime-dim', `rgba(${r},${g},${b},0.09)`);
    root.style.setProperty('--color-lime-line', `rgba(${r},${g},${b},0.32)`);
  }, [p.theme, p.accent]);
}

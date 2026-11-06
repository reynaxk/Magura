'use client';

import { readUiPrefs, type SoundEvent, type SoundId } from './ui-prefs';

let ctx: AudioContext | null = null;
const ac = () => {
  if (typeof window === 'undefined') return null;
  ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

/** Short synthesized notes — no audio files to download. */
function tone(freqs: number[], dur: number, type: OscillatorType, vol: number, gap = 0.07) {
  const a = ac();
  if (!a) return;
  freqs.forEach((f, i) => {
    const t = a.currentTime + i * gap;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  });
}

export function playSound(id: SoundId, volume = readUiPrefs().volume) {
  const v = 0.25 * volume;
  switch (id) {
    case 'tick':
      return tone([1320], 0.06, 'square', v * 0.5);
    case 'pop':
      return tone([660, 990], 0.08, 'sine', v);
    case 'chime':
      return tone([784, 988, 1319], 0.35, 'sine', v, 0.09);
    case 'kaching':
      return tone([1568, 2093, 2637], 0.18, 'triangle', v, 0.05);
    case 'bell':
      return tone([880, 1760], 0.6, 'sine', v, 0.01);
    case 'blip':
      return tone([520, 390], 0.12, 'sawtooth', v * 0.6, 0.08);
    default:
      return;
  }
}

/** Play whatever sound the user picked for this event. */
export function soundFor(event: SoundEvent) {
  const p = readUiPrefs();
  const id = p.sounds[event];
  if (id && id !== 'off') playSound(id, p.volume);
}

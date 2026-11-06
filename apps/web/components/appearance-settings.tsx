'use client';

import { playSound } from '@/lib/sounds';
import { ACCENTS, SOUNDS, SOUND_EVENTS, THEMES, useUiPrefs, type SoundId } from '@/lib/ui-prefs';
import { Segmented } from './ui';

/** Settings → Appearance: theme presets and accent colour. Saved on this device. */
export function AppearanceSettings() {
  const [p, set] = useUiPrefs();
  return (
    <>
      <h2 className="text-lg font-semibold">Appearance</h2>
      <div className="flex items-center gap-4 rounded-2xl border border-line-2 bg-raised p-4">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">Layout</span>
          <span className="text-xs text-muted">Pro: dense rows, always-open market rail, dock windows</span>
        </span>
        <Segmented
          label="Layout"
          value={p.layout}
          onChange={(layout) => set({ ...p, layout })}
          options={[
            { value: 'clean', label: 'Clean' },
            { value: 'pro', label: 'Pro' },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEMES.map((t) => {
          const on = p.theme === t.id;
          return (
            <button
              key={t.id}
              aria-pressed={on}
              onClick={() => set({ ...p, theme: t.id, accent: null })}
              className={`flex flex-col gap-2.5 rounded-2xl border p-3 text-left transition-colors ${on ? 'border-lime-line bg-lime-dim' : 'border-line-2 bg-raised hover:border-line-3'}`}
            >
              <span className="flex h-16 overflow-hidden rounded-xl border border-white/5" style={{ background: t.swatch[0] }}>
                <span className="m-2 flex flex-1 flex-col gap-1.5 rounded-lg p-2" style={{ background: t.swatch[1] }}>
                  <span className="h-1.5 w-2/3 rounded-full bg-white/20" />
                  <span className="h-1.5 w-1/3 rounded-full" style={{ background: t.swatch[2] }} />
                </span>
              </span>
              <span className="text-[13px] font-semibold">{t.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <span className="label">Accent colour</span>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((c) => (
            <button
              key={c}
              aria-label={`Accent ${c}`}
              aria-pressed={p.accent === c}
              onClick={() => set({ ...p, accent: c })}
              className={`h-9 w-9 rounded-full border-2 ${p.accent === c ? 'border-text' : 'border-transparent'}`}
              style={{ background: c }}
            />
          ))}
          <button onClick={() => set({ ...p, accent: null })} className={`h-9 rounded-full px-3 text-xs font-semibold ${p.accent == null ? 'bg-text text-bg' : 'bg-raised text-text-2'}`}>
            Theme default
          </button>
        </div>
      </div>
    </>
  );
}

/** Settings → Sounds & toasts: a sound per event, volume, where toasts appear. */
export function SoundSettings() {
  const [p, set] = useUiPrefs();
  return (
    <>
      <h2 className="text-lg font-semibold">Sounds & toasts</h2>
      <div className="flex items-center gap-4 rounded-2xl border border-line-2 bg-raised p-4">
        <span className="flex-1 text-sm font-semibold">Volume</span>
        <input type="range" min={0} max={100} value={Math.round(p.volume * 100)} onChange={(e) => set({ ...p, volume: Number(e.target.value) / 100 })} className="w-40 accent-[var(--color-lime)]" aria-label="Volume" />
        <span className="num w-10 text-right text-sm">{Math.round(p.volume * 100)}%</span>
      </div>
      <div className="flex flex-col divide-y divide-line rounded-2xl border border-line-2">
        {SOUND_EVENTS.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm">{e.label}</span>
            <select
              aria-label={`Sound for ${e.label}`}
              value={p.sounds[e.id]}
              onChange={(ev) => {
                const v = ev.target.value as SoundId;
                set({ ...p, sounds: { ...p.sounds, [e.id]: v } });
                if (v !== 'off') playSound(v, p.volume);
              }}
              className="h-9 rounded-xl border border-line-2 bg-raised px-2.5 text-[13px] capitalize text-text"
            >
              {SOUNDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button aria-label={`Play ${e.label} sound`} onClick={() => playSound(p.sounds[e.id], p.volume)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-raised text-text-2 hover:text-lime">
              ▶
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-sm font-semibold">Toast position</span>
        <Segmented
          label="Toast position"
          value={p.toastPosition}
          onChange={(toastPosition) => set({ ...p, toastPosition })}
          options={[
            { value: 'top-right', label: 'Top right' },
            { value: 'top-center', label: 'Top' },
            { value: 'bottom-right', label: 'Bottom right' },
            { value: 'bottom-left', label: 'Bottom left' },
          ]}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm font-semibold">Toasts on screen at once</span>
        <Segmented label="Max toasts" value={String(p.maxToasts) as '1' | '2' | '4' | '6'} onChange={(v) => set({ ...p, maxToasts: Number(v) })} options={['1', '2', '4', '6'].map((v) => ({ value: v as '1' | '2' | '4' | '6', label: v }))} />
      </div>
    </>
  );
}

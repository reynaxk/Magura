'use client';

import { useEffect, useState } from 'react';
import { CARD_FIELDS, DEFAULT_TRENCH_PREFS, type CardField, type TrenchPrefs } from '@/lib/trench-prefs';
import { Segmented, Toggle } from './ui';

type Tab = 'display' | 'data' | 'alerts';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-line py-3 first:border-t-0">
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

/** Customize: how Trenches cards look and what they show. Saved on this device. */
export function TrenchCustomize({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: TrenchPrefs; onChange: (p: TrenchPrefs) => void }) {
  const [tab, setTab] = useState<Tab>('display');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const set = (patch: Partial<TrenchPrefs>) => onChange({ ...value, ...patch });
  const toggleField = (f: CardField) => set({ fields: value.fields.includes(f) ? value.fields.filter((x) => x !== f) : CARD_FIELDS.map((x) => x.id).filter((x) => x === f || value.fields.includes(x)) });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label="Customize Trenches">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div className="relative flex max-h-[88dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[26px] border border-line bg-[#0B0D11] shadow-2xl md:rounded-[26px]">
        <header className="flex items-center gap-3 px-6 pb-2 pt-5">
          <h2 className="text-[19px] font-semibold tracking-tight">Customize</h2>
          <button onClick={() => onChange(DEFAULT_TRENCH_PREFS)} className="ml-auto rounded-lg bg-raised px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:text-text">
            Reset
          </button>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-muted hover:text-text">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div role="tablist" className="flex gap-6 border-b border-line px-6">
          {(
            [
              ['display', 'Display'],
              ['data', 'Data'],
              ['alerts', 'Warnings'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`relative pb-3 text-[14px] font-semibold ${tab === id ? 'text-text' : 'text-muted hover:text-text-2'}`}>
              {label}
              {tab === id && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-lime" />}
            </button>
          ))}
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-3">
          {tab === 'display' && (
            <>
              <Row label="Card size">
                <Segmented
                  label="Card size"
                  value={value.size}
                  onChange={(size) => set({ size })}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'comfy', label: 'Comfy' },
                    { value: 'large', label: 'Large' },
                  ]}
                />
              </Row>
              <Row label="Buy button">
                <Segmented
                  label="Buy button size"
                  value={value.buttonSize}
                  onChange={(buttonSize) => set({ buttonSize })}
                  options={[
                    { value: 'sm', label: 'S' },
                    { value: 'md', label: 'M' },
                    { value: 'lg', label: 'L' },
                  ]}
                />
              </Row>
              <Toggle on={value.secondBuy} onChange={(secondBuy) => set({ secondBuy })} label="Second buy button" hint="A bigger (or smaller) size one tap away" />
              {value.secondBuy && (
                <Row label="Second amount" hint="In the chain's coin (SOL, BNB, ETH)">
                  <input
                    inputMode="decimal"
                    value={value.secondAmount}
                    onChange={(e) => set({ secondAmount: e.target.value.replace(/[^0-9.]/g, '').slice(0, 8) })}
                    className="num h-9 w-24 rounded-xl border border-line-2 bg-raised px-3 text-right text-sm outline-none focus:border-lime-line"
                  />
                </Row>
              )}
              <Row label="Bonding progress">
                <Segmented
                  label="Bonding progress"
                  value={value.progress}
                  onChange={(progress) => set({ progress })}
                  options={[
                    { value: 'ring', label: 'Ring' },
                    { value: 'bar', label: 'Bar' },
                  ]}
                />
              </Row>
              <Row label="Logo">
                <Segmented
                  label="Logo shape"
                  value={value.logo}
                  onChange={(logo) => set({ logo })}
                  options={[
                    { value: 'square', label: 'Square' },
                    { value: 'circle', label: 'Circle' },
                  ]}
                />
              </Row>
              <Row label="Tap a card" hint="On desktop">
                <Segmented
                  label="Tap action"
                  value={value.click}
                  onChange={(click) => set({ click })}
                  options={[
                    { value: 'panel', label: 'Side panel' },
                    { value: 'page', label: 'Open chart' },
                  ]}
                />
              </Row>
              <Toggle on={value.hideDevSold} onChange={(hideDevSold) => set({ hideDevSold })} label="Hide coins the dev dumped" hint="Removes cards as soon as the creator sells everything" />
            </>
          )}

          {tab === 'data' && (
            <div className="flex flex-col gap-5 py-2">
              {(
                [
                  ['market', 'Market'],
                  ['supply', 'Who holds the supply'],
                  ['token', 'Token'],
                  ['social', 'Social'],
                ] as const
              ).map(([g, label]) => (
                <div key={g} className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</span>
                  <div className="flex flex-wrap gap-2">
                    {CARD_FIELDS.filter((f) => f.group === g).map((f) => {
                      const on = value.fields.includes(f.id);
                      return (
                        <button
                          key={f.id}
                          aria-pressed={on}
                          onClick={() => toggleField(f.id)}
                          className={`h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${on ? 'border-lime-line bg-lime-dim text-text' : 'border-line-2 text-faint hover:text-text-2'}`}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'alerts' && (
            <>
              <p className="pb-2 pt-1 text-xs text-muted">A chip turns red when this share of the supply is above your line.</p>
              {(
                [
                  ['top10', 'Top 10 holders'],
                  ['dev', 'Dev'],
                  ['snipers', 'Snipers'],
                  ['bundlers', 'Bundlers'],
                  ['insiders', 'Insiders'],
                  ['fresh', 'Fresh wallets'],
                ] as const
              ).map(([k, label]) => (
                <Row key={k} label={label}>
                  <span className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={80}
                      value={value.warn[k]}
                      onChange={(e) => set({ warn: { ...value.warn, [k]: Number(e.target.value) } })}
                      className="w-36 accent-[#2FE39A]"
                      aria-label={`${label} warning line`}
                    />
                    <span className="num w-10 text-right text-sm">{value.warn[k]}%</span>
                  </span>
                </Row>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

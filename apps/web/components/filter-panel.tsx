'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CHAIN_IDS,
  CHAINS,
  EMPTY_FILTER,
  RANGE_FIELDS,
  SOURCES,
  activeFilterCount,
  type CoinFilter,
  type Range,
  type RangeKey,
  type SourceId,
} from '@magura/shared';

/* ───────────── persistence ───────────── */

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — keep in memory */
  }
}

/** The filter for one scope (Hunt, a Trenches column), remembered on this device. */
export function useStoredFilter(scope: string): [CoinFilter, (f: CoinFilter) => void] {
  const [f, setF] = useState<CoinFilter>(EMPTY_FILTER);
  useEffect(() => setF({ ...EMPTY_FILTER, ...read<Partial<CoinFilter>>(`magura:filter:${scope}`, {}) }), [scope]);
  return [
    f,
    (next) => {
      setF(next);
      write(`magura:filter:${scope}`, next);
    },
  ];
}

interface Preset {
  id: string;
  name: string;
  filter: CoinFilter;
}

/* ───────────── small parts ───────────── */

function Check({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={() => onChange(!on)} className="group flex items-center gap-2.5 py-1.5 text-left text-[13px] text-text-2">
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors ${on ? 'border-lime bg-lime' : 'border-line-3 bg-raised group-hover:border-faint'}`}
      >
        {on && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#07090A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </span>
      {children}
    </button>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line py-5 last:border-0">
      <div className="flex items-center">
        <h3 className="text-[13px] font-semibold tracking-tight text-text">{title}</h3>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function RangeInput({ value, unit, placeholder, onChange }: { value: number | undefined; unit: string; placeholder: string; onChange: (v: number | undefined) => void }) {
  return (
    <label className="flex h-10 flex-1 items-center rounded-xl border border-line-2 bg-raised px-3 focus-within:border-line-3">
      <span className="sr-only">{placeholder}</span>
      <input
        inputMode="decimal"
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.-]/g, '');
          onChange(raw === '' || raw === '-' ? undefined : Number(raw));
        }}
        placeholder={placeholder}
        className="num w-full min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
      />
      {unit && <span className="num ml-1 text-[11px] text-faint">{unit}</span>}
    </label>
  );
}

function TextInput({ value, placeholder, onChange, label, mono }: { value: string; placeholder: string; onChange: (v: string) => void; label: string; mono?: boolean }) {
  return (
    <label className="flex h-10 items-center rounded-xl border border-line-2 bg-raised px-3 focus-within:border-lime-line">
      <span className="sr-only">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`w-full bg-transparent text-[13px] outline-none placeholder:text-faint ${mono ? 'num' : ''}`} />
    </label>
  );
}

/* ───────────── panel ───────────── */

export function FilterPanel({
  open,
  onClose,
  title,
  scope,
  value,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  scope: string;
  value: CoinFilter;
  onApply: (f: CoinFilter) => void;
}) {
  const [draft, setDraft] = useState<CoinFilter>(value);
  const [tab, setTab] = useState<'filters' | 'saved'>('filters');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(value);
      setTab('filters');
      setPresets(read<Preset[]>('magura:presets', []));
    }
  }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const active = activeFilterCount(draft);
  const visibleSources = useMemo(() => SOURCES.filter((s) => s.chains.some((c) => draft.chains.includes(c))), [draft.chains]);
  const setRange = (k: RangeKey, r: Range) => setDraft((d) => ({ ...d, ranges: { ...d.ranges, [k]: r } }));
  const toggleSource = (id: SourceId) =>
    setDraft((d) => ({ ...d, sources: d.sources.includes(id) ? d.sources.filter((x) => x !== id) : [...d.sources, id] }));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Filters · ${title}`}>
      <button aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div
        className="relative mt-auto flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[26px] border border-line bg-[#0B0D11] shadow-[0_-20px_60px_rgba(0,0,0,0.5)] md:mt-0 md:h-full md:max-h-none md:w-[460px] md:rounded-none md:rounded-l-[26px]"
        style={{ backgroundImage: 'radial-gradient(120% 60% at 100% 0%, rgba(47,227,154,0.06), transparent 60%)' }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-3 md:hidden" />
        <header className="flex items-center gap-3 px-6 pb-3 pt-5">
          <h2 className="text-[19px] font-semibold tracking-tight">
            Filters <span className="text-muted">·</span> <span className="text-text-2">{title}</span>
          </h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-raised text-muted hover:text-text">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div role="tablist" className="flex gap-6 border-b border-line px-6">
          {(
            [
              ['filters', 'Filters'],
              ['saved', 'Saved'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`relative flex items-center gap-2 pb-3 text-[14px] font-semibold ${tab === id ? 'text-text' : 'text-muted hover:text-text-2'}`}
            >
              {label}
              {id === 'filters' && active > 0 && <span className="num rounded-full bg-lime-dim px-1.5 text-[11px] text-lime">{active}</span>}
              {id === 'saved' && presets.length > 0 && <span className="num rounded-full bg-raised px-1.5 text-[11px] text-muted">{presets.length}</span>}
              {tab === id && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-lime" />}
            </button>
          ))}
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-6">
          {tab === 'filters' ? (
            <>
              <Section title="Search">
                <div className="grid grid-cols-2 gap-2">
                  <TextInput value={draft.keywords ?? ''} placeholder="Keywords, e.g. cat, ai" onChange={(keywords) => setDraft({ ...draft, keywords })} label="Include keywords" />
                  <TextInput value={draft.excludeKeywords ?? ''} placeholder="Exclude words" onChange={(excludeKeywords) => setDraft({ ...draft, excludeKeywords })} label="Exclude keywords" />
                  <div className="col-span-2">
                    <TextInput value={draft.devWallet ?? ''} placeholder="Dev wallet address" onChange={(devWallet) => setDraft({ ...draft, devWallet })} label="Dev wallet" mono />
                  </div>
                </div>
              </Section>

              <Section title="Chains">
                <div className="flex flex-wrap gap-2">
                  {CHAIN_IDS.map((c) => {
                    const on = draft.chains.includes(c);
                    return (
                      <button
                        key={c}
                        aria-pressed={on}
                        onClick={() => setDraft((d) => ({ ...d, chains: on ? (d.chains.length > 1 ? d.chains.filter((x) => x !== c) : d.chains) : [...d.chains, c] }))}
                        className={`h-9 rounded-full border px-4 text-[13px] font-semibold transition-colors ${on ? 'border-lime-line bg-lime-dim text-text' : 'border-line-2 text-faint hover:text-text-2'}`}
                      >
                        {CHAINS[c].name}
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section
                title="Launchpads & DEXs"
                action={
                  <button
                    onClick={() => setDraft((d) => ({ ...d, sources: d.sources.length ? [] : visibleSources.map((s) => s.id) }))}
                    className="rounded-lg bg-raised px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:text-text"
                  >
                    {draft.sources.length ? 'Unselect all' : 'Select all'}
                  </button>
                }
              >
                <div className="flex flex-wrap gap-2">
                  {visibleSources.map((s) => {
                    const on = draft.sources.length === 0 || draft.sources.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        aria-pressed={draft.sources.includes(s.id)}
                        onClick={() => toggleSource(s.id)}
                        className="flex h-9 items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-[13px] font-semibold transition-all"
                        style={{
                          borderColor: on ? `${s.color}55` : '#1F232B',
                          background: on ? `${s.color}14` : 'transparent',
                          color: on ? '#E9ECF2' : '#7A8397',
                        }}
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-[#07090A]" style={{ background: on ? s.color : '#2A303C' }}>
                          {s.label[0]}
                        </span>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-faint">{draft.sources.length ? `${draft.sources.length} selected` : 'All sources'}</p>
              </Section>

              <Section title="Dev behaviour">
                <div className="grid grid-cols-2 gap-x-4">
                  <Check on={!!draft.devStillHolding} onChange={(v) => setDraft({ ...draft, devStillHolding: v, devSoldAll: v ? false : draft.devSoldAll })}>
                    Dev still holding
                  </Check>
                  <Check on={!!draft.devSoldAll} onChange={(v) => setDraft({ ...draft, devSoldAll: v, devStillHolding: v ? false : draft.devStillHolding })}>
                    Dev sold all
                  </Check>
                </div>
              </Section>

              <Section title="Socials & dev">
                <div className="grid grid-cols-2 gap-x-4">
                  <Check on={draft.hasX} onChange={(v) => setDraft({ ...draft, hasX: v })}>
                    Has X
                  </Check>
                  <Check on={draft.hasTelegram} onChange={(v) => setDraft({ ...draft, hasTelegram: v })}>
                    Has Telegram
                  </Check>
                  <Check on={draft.hasWebsite} onChange={(v) => setDraft({ ...draft, hasWebsite: v })}>
                    Has website
                  </Check>
                  <Check on={draft.devUnder20} onChange={(v) => setDraft({ ...draft, devUnder20: v })}>
                    Dev holds under 20%
                  </Check>
                </div>
              </Section>

              <Section title="Token audit">
                <div className="grid grid-cols-2 gap-x-4">
                  <Check on={draft.excludeMintable} onChange={(v) => setDraft({ ...draft, excludeMintable: v })}>
                    Exclude mintable
                  </Check>
                  <Check on={draft.excludeFreezable} onChange={(v) => setDraft({ ...draft, excludeFreezable: v })}>
                    Exclude freezable
                  </Check>
                  <Check on={draft.auditedOnly} onChange={(v) => setDraft({ ...draft, auditedOnly: v })}>
                    Audited only
                  </Check>
                </div>
              </Section>

              <Section title="Magura signals">
                <Check on={draft.friendsBought} onChange={(v) => setDraft({ ...draft, friendsBought: v })}>
                  People I follow bought it
                </Check>
              </Section>

              {(
                [
                  ['market', 'Market'],
                  ['holders', 'Holders & supply'],
                  ['dev', 'Dev history'],
                  ['social', 'Social'],
                ] as const
              ).map(([group, label]) => (
                <Section key={group} title={label}>
                  <div className="flex flex-col gap-2.5">
                    {RANGE_FIELDS.filter((r) => r.group === group).map((r) => {
                      const v = draft.ranges[r.key] ?? {};
                      return (
                        <div key={r.key} className="grid grid-cols-[1fr_minmax(0,108px)_minmax(0,108px)] items-center gap-2">
                          <span className="text-[13px] text-text-2">{r.label}</span>
                          <RangeInput value={v.min} unit={r.unit} placeholder="Min" onChange={(min) => setRange(r.key, { ...v, min })} />
                          <RangeInput value={v.max} unit={r.unit} placeholder="Max" onChange={(max) => setRange(r.key, { ...v, max })} />
                        </div>
                      );
                    })}
                  </div>
                </Section>
              ))}
            </>
          ) : (
            <div className="flex flex-col gap-3 py-5">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!presetName.trim()) return;
                  const next = [{ id: Math.random().toString(36).slice(2), name: presetName.trim().slice(0, 30), filter: draft }, ...presets].slice(0, 20);
                  setPresets(next);
                  write('magura:presets', next);
                  setPresetName('');
                }}
              >
                <label className="flex h-11 flex-1 items-center rounded-xl border border-line-2 bg-raised px-3.5">
                  <span className="sr-only">Preset name</span>
                  <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name this filter, e.g. Safe runners" className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint" />
                </label>
                <button className="btn-lime h-11" disabled={!presetName.trim()}>
                  Save
                </button>
              </form>
              <div className="flex gap-2">
                <button
                  className="btn-ghost h-9 flex-1 text-xs"
                  onClick={() => {
                    void navigator.clipboard?.writeText(btoa(unescape(encodeURIComponent(JSON.stringify(draft)))));
                    setNote('Filter code copied — share it with anyone');
                  }}
                >
                  Export current
                </button>
                <button
                  className="btn-ghost h-9 flex-1 text-xs"
                  onClick={async () => {
                    const raw = (await navigator.clipboard?.readText().catch(() => '')) || window.prompt('Paste a filter code') || '';
                    try {
                      const f = JSON.parse(decodeURIComponent(escape(atob(raw.trim())))) as CoinFilter;
                      setDraft({ ...EMPTY_FILTER, ...f, ranges: { ...(f.ranges ?? {}) } });
                      setTab('filters');
                    } catch {
                      setNote("That isn't a Magura filter code");
                    }
                  }}
                >
                  Import code
                </button>
              </div>
              {note && <p className="text-center text-[12px] text-text-2">{note}</p>}
              {presets.length === 0 && <p className="py-8 text-center text-[13px] text-muted">Save filters you use often and switch between them in one tap.</p>}
              {presets.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-line-2 bg-raised p-3.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    <span className="text-[11px] text-muted">{activeFilterCount(p.filter)} rules</span>
                  </span>
                  <button
                    className="btn-ghost h-9 text-xs"
                    onClick={() => {
                      setDraft(p.filter);
                      setTab('filters');
                    }}
                  >
                    Use
                  </button>
                  <button
                    aria-label={`Delete ${p.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-down-dim hover:text-down-2"
                    onClick={() => {
                      const next = presets.filter((x) => x.id !== p.id);
                      setPresets(next);
                      write('magura:presets', next);
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex gap-2.5 border-t border-line bg-[#0B0D11]/95 px-6 pb-[max(env(safe-area-inset-bottom),16px)] pt-4 backdrop-blur">
          <button onClick={() => setDraft({ ...EMPTY_FILTER })} className="h-[52px] rounded-2xl bg-raised px-6 text-[15px] font-semibold text-text hover:bg-hover">
            Reset
          </button>
          <button
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className="h-[52px] flex-1 rounded-2xl bg-lime text-[15px] font-semibold text-[#07090A] shadow-[0_8px_30px_rgba(47,227,154,0.25)] hover:brightness-110"
          >
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The "Filters" button with the active-rule badge. */
export function FilterButton({ filter, onClick, compact }: { filter: CoinFilter; onClick: () => void; compact?: boolean }) {
  const n = activeFilterCount(filter);
  return (
    <button
      onClick={onClick}
      aria-label={`Filters${n ? `, ${n} active` : ''}`}
      className={`flex items-center gap-2 rounded-xl border font-semibold transition-colors ${compact ? 'h-8 px-2.5 text-xs' : 'h-10 px-3.5 text-[13px]'} ${n ? 'border-lime-line bg-lime-dim text-lime' : 'border-line-2 bg-raised text-text-2 hover:text-text'}`}
    >
      <svg width={compact ? 13 : 15} height={compact ? 13 : 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M7 12h10M10 18h4" />
      </svg>
      {!compact && 'Filters'}
      {n > 0 && <span className="num flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-lime px-1 text-[10px] text-[#07090A]">{n}</span>}
    </button>
  );
}

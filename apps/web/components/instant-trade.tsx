'use client';

import { useEffect, useState } from 'react';
import { usePresets, useInstantTrade, type TradeTarget } from '@/lib/trade';
import { usePref } from '@/lib/prefs';
import { Icon, Svg } from './ui';
import { AddFunds } from './add-funds';

const BUY_KEYS = ['1', '2', '3', '4'];
const SELL_KEYS = ['q', 'w', 'e', 'r'];

function typing(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function PresetTabs() {
  const { presets, active, setActive } = usePresets();
  return (
    <div role="tablist" aria-label="Presets" className="num flex gap-0.5 rounded-lg border border-line-2 p-0.5 text-[11px]">
      {presets.map((p, i) => (
        <button
          key={p.name + i}
          role="tab"
          aria-selected={i === active}
          onClick={() => setActive(i)}
          className={`rounded-md px-2 py-0.5 ${i === active ? 'bg-line-2 text-text' : 'text-muted hover:text-text'}`}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

function PresetEditor({ chain, onDone }: { chain: TradeTarget['chain']; onDone: () => void }) {
  const { presets, active, save } = usePresets();
  const p = presets[active];
  const [buy, setBuy] = useState<string[]>(p.buy[chain] ?? ['', '', '', '']);
  const [sell, setSell] = useState<string[]>(p.sell.map(String));
  const [slip, setSlip] = useState(String(p.slippageBps / 100));
  const valid = buy.every((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0) && sell.every((v) => Number(v) >= 1 && Number(v) <= 100) && Number(slip) >= 0.1 && Number(slip) <= 50;
  const submit = async () => {
    const next = presets.map((x, i) =>
      i === active ? { ...x, buy: { ...x.buy, [chain]: buy }, sell: sell.map((v) => Math.round(Number(v))), slippageBps: Math.round(Number(slip) * 100) } : x,
    );
    await save({ tradePresets: next });
    onDone();
  };
  const cell = 'input num h-8 px-2 text-center text-xs';
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-raised p-2.5 text-[11px] text-muted">
      <span>Buy amounts</span>
      <div className="grid grid-cols-4 gap-1.5">
        {buy.map((v, i) => (
          <input key={i} aria-label={`Buy amount ${i + 1}`} className={cell} inputMode="decimal" value={v} onChange={(e) => setBuy(buy.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, '') : x)))} />
        ))}
      </div>
      <span>Sell % of position</span>
      <div className="grid grid-cols-4 gap-1.5">
        {sell.map((v, i) => (
          <input key={i} aria-label={`Sell percent ${i + 1}`} className={cell} inputMode="numeric" value={v} onChange={(e) => setSell(sell.map((x, j) => (j === i ? e.target.value.replace(/\D/g, '') : x)))} />
        ))}
      </div>
      <label className="flex items-center justify-between gap-2">
        Slippage %
        <input className={`${cell} w-20`} inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value.replace(/[^\d.]/g, ''))} />
      </label>
      <div className="flex gap-1.5">
        <button className="btn-ghost h-8 flex-1 text-xs" onClick={onDone}>
          Cancel
        </button>
        <button className="btn-lime h-8 flex-1 text-xs" disabled={!valid} onClick={submit}>
          Save {p.name}
        </button>
      </div>
    </div>
  );
}

function Buttons({ target, compact }: { target: TradeTarget; compact?: boolean }) {
  const { run, busy, buyAmounts, sellPcts, native } = useInstantTrade(target);
  const h = compact ? 'h-9' : 'h-12 md:h-9';
  return (
    <>
      <span className="flex items-center justify-between text-[11px] text-muted">
        Buy ({native})
        <AddFunds variant="link" defaultChain={target.chain === 'solana' ? 'solana' : target.chain === 'ethereum' ? 'ethereum' : 'base'} />
      </span>
      <div className="num grid grid-cols-4 gap-1.5 text-[13px] font-semibold">
        {buyAmounts.map((a, i) => (
          <button
            key={a + i}
            disabled={!!busy}
            onClick={() => run('buy', a)}
            title={`Buy ${a} ${native} · key ${BUY_KEYS[i]}`}
            className={`${h} rounded-[10px] border border-lime-line bg-lime-dim text-lime hover:bg-[#0f2a1f] disabled:opacity-50`}
          >
            {busy === `buy:${a}` ? '…' : a}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-muted">Sell (% of position)</span>
      <div className="num grid grid-cols-4 gap-1.5 text-[13px] font-semibold">
        {sellPcts.map((p, i) => (
          <button
            key={p + '-' + i}
            disabled={!!busy}
            onClick={() => run('sell', p)}
            title={`Sell ${p}% · key ${SELL_KEYS[i].toUpperCase()}`}
            className={`${h} rounded-[10px] border border-down-line bg-down-dim text-down-2 hover:bg-[#241316] disabled:opacity-50`}
          >
            {busy === `sell:${p}` ? '…' : `${p}%`}
          </button>
        ))}
      </div>
    </>
  );
}

/** Hotkeys for the coin on screen: 1–4 buy, Q/W/E/R sell. Ignored while typing. */
function useTradeHotkeys(target: TradeTarget) {
  const { run, buyAmounts, sellPcts } = useInstantTrade(target);
  const [enabled] = usePref<boolean>('hotkeys', true);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      const b = BUY_KEYS.indexOf(k);
      const s = SELL_KEYS.indexOf(k);
      if (b >= 0 && buyAmounts[b]) {
        e.preventDefault();
        run('buy', buyAmounts[b]);
      } else if (s >= 0 && sellPcts[s]) {
        e.preventDefault();
        run('sell', sellPcts[s]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, run, buyAmounts, sellPcts]);
}

/** Floating panel on desktop, bottom sheet on phones. Lives on the coin page. */
export function InstantTrade({ target }: { target: TradeTarget }) {
  const { preset } = usePresets();
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState(false);
  useTradeHotkeys(target);

  const body = (
    <>
      <div className="flex items-center gap-2">
        <Svg d={Icon.bolt} size={14} color="#2FE39A" />
        <span className="whitespace-nowrap text-[13px] font-semibold">Instant trade</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{target.symbol}</span>
        <span className="shrink-0">
          <PresetTabs />
        </span>
      </div>
      {editing ? <PresetEditor chain={target.chain} onDone={() => setEditing(false)} /> : <Buttons target={target} />}
      <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span>Slippage {(preset.slippageBps / 100).toFixed(1)}%</span>
        <span className="hidden md:inline">Keys 1–4 buy · Q W E R sell</span>
        {!editing && (
          <button onClick={() => setEditing(true)} className="ml-auto text-muted hover:text-text">
            Edit {preset.name}
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* desktop: docked above the order ticket */}
      <section aria-label="Instant trade" className="panel hidden flex-col gap-2.5 p-4 md:flex">
        {body}
      </section>

      {/* phone */}
      <div className="md:hidden">
        {!sheet && (
          <button onClick={() => setSheet(true)} className="fixed bottom-[88px] right-3 z-30 flex h-12 items-center gap-2 rounded-2xl bg-lime px-4 text-sm font-semibold text-bg shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            <Svg d={Icon.bolt} size={16} />
            Trade
          </button>
        )}
        {sheet && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={() => setSheet(false)}>
            <section
              aria-label="Instant trade"
              onClick={(e) => e.stopPropagation()}
              className="flex flex-col gap-3 rounded-t-[22px] border-t border-line-3 bg-raised px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2.5"
            >
              <button aria-label="Close" onClick={() => setSheet(false)} className="mx-auto h-1 w-10 rounded-full bg-line-3" />
              {body}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

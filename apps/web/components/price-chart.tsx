'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { Candle, ChainId, Timeframe } from '@magura/shared';
import { api } from '@/lib/api';

export interface ChartMarker {
  at: string;
  side: 'buy' | 'sell';
  label: string;
  /** dev / you / friend — sets the colour */
  kind?: 'friend' | 'dev' | 'you' | 'smart';
}

const KIND_COLOR = { dev: '#F5A64A', you: '#E9ECF2', smart: '#A78BFA' } as const;

export interface ChartLine {
  price: number;
  label: string;
  color: string;
}

export function PriceChart({
  chain,
  pool,
  tf,
  height = 320,
  markers = [],
  lines = [],
}: {
  chain: ChainId;
  pool: string | null;
  tf: Timeframe;
  height?: number;
  markers?: ChartMarker[];
  lines?: ChartLine[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const candles = useQuery({
    queryKey: ['ohlcv', chain, pool, tf],
    queryFn: () => api<Candle[]>(`/market/ohlcv/${chain}/${pool}?tf=${tf}`),
    enabled: !!pool,
    refetchInterval: tf === '1m' ? 10_000 : 30_000,
  });

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8A93A6', fontFamily: 'var(--font-geist-mono)' },
      grid: { vertLines: { color: '#14171E' }, horzLines: { color: '#14171E' } },
      rightPriceScale: { borderColor: '#1A1D25' },
      timeScale: { borderColor: '#1A1D25', timeVisible: true },
      crosshair: { mode: 1 },
    });
    candleRef.current = chart.addCandlestickSeries({
      upColor: '#2FE39A',
      downColor: '#FF6B6B',
      borderVisible: false,
      wickUpColor: '#2FE39A',
      wickDownColor: '#FF6B6B',
      priceFormat: { type: 'price', precision: 6, minMove: 0.000001 },
    });
    volRef.current = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' } });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    return () => chart.remove();
  }, [height]);

  useEffect(() => {
    const data = candles.data;
    if (!data || !candleRef.current || !volRef.current) return;
    candleRef.current.setData(data.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    volRef.current.setData(data.map((c) => ({ time: c.t as UTCTimestamp, value: c.v, color: c.c >= c.o ? 'rgba(47,227,154,0.22)' : 'rgba(255,107,107,0.22)' })));
  }, [candles.data]);

  // Friends' buys and sells, snapped to the candle they happened in.
  useEffect(() => {
    const data = candles.data;
    if (!data?.length || !candleRef.current) return;
    const times = data.map((c) => c.t);
    const snap = (sec: number) => {
      let lo = 0;
      let hi = times.length - 1;
      if (sec < times[0]) return null;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= sec) lo = mid;
        else hi = mid - 1;
      }
      return times[lo];
    };
    const ms = markers
      .map((m) => ({ m, t: snap(Math.floor(new Date(m.at).getTime() / 1000)) }))
      .filter((x): x is { m: ChartMarker; t: number } => x.t != null)
      .sort((a, b) => a.t - b.t)
      .map(({ m, t }) => ({
        time: t as UTCTimestamp,
        position: m.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
        color: m.kind && m.kind !== 'friend' ? KIND_COLOR[m.kind] : m.side === 'buy' ? '#2FE39A' : '#FF6B6B',
        shape: m.kind === 'dev' ? ('circle' as const) : m.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
        text: m.label,
      }));
    candleRef.current.setMarkers(ms);
  }, [candles.data, markers]);

  // horizontal lines: your average entry, alerts…
  const lineKey = lines.map((l) => `${l.label}:${l.price}`).join('|');
  useEffect(() => {
    const series = candleRef.current;
    if (!series || !candles.data?.length) return;
    const made = lines.filter((l) => Number.isFinite(l.price) && l.price > 0).map((l) => series.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.label }));
    return () => made.forEach((pl) => series.removePriceLine(pl));
  }, [lineKey, candles.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative rounded-[14px] border border-[#171A22] bg-bar" style={{ height }}>
      <div ref={ref} className="absolute inset-0" />
      {!pool && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">No DEX pair yet — still on the bonding curve</div>}
      {pool && candles.isError && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Chart data unavailable</div>}
    </div>
  );
}

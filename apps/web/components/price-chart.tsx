'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { Candle, ChainId, Timeframe } from '@magura/shared';
import { api } from '@/lib/api';

export function PriceChart({ chain, pool, tf, height = 320 }: { chain: ChainId; pool: string | null; tf: Timeframe; height?: number }) {
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

  return (
    <div className="relative rounded-[14px] border border-[#171A22] bg-bar" style={{ height }}>
      <div ref={ref} className="absolute inset-0" />
      {!pool && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">No DEX pair yet — still on the bonding curve</div>}
      {pool && candles.isError && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Chart data unavailable</div>}
    </div>
  );
}

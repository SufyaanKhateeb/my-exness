'use client';

import { type ChangeEvent } from 'react';

import type { IntervalUnit } from '@/lib/market-terminal';

type ChartToolbarProps = {
  isConnected: boolean;
  minuteCandleCount: number;
  dayCandleCount: number;
  hasLiveCandles: boolean;
  intervalAmount: number;
  intervalUnit: IntervalUnit;
  onIntervalAmountChange: (nextValue: number) => void;
  onIntervalUnitChange: (nextValue: IntervalUnit) => void;
};

export function ChartToolbar({
  isConnected,
  minuteCandleCount,
  dayCandleCount,
  hasLiveCandles,
  intervalAmount,
  intervalUnit,
  onIntervalAmountChange,
  onIntervalUnitChange,
}: ChartToolbarProps) {
  const handleAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number.parseInt(event.target.value, 10);
    onIntervalAmountChange(Number.isFinite(nextValue) ? Math.max(1, nextValue) : 1);
  };

  const handleUnitChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onIntervalUnitChange(event.target.value as IntervalUnit);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full border px-2.5 py-1 ${
            isConnected
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
          }`}
        >
          {isConnected ? 'SpacetimeDB connected' : 'SpacetimeDB disconnected'}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
          {minuteCandleCount} minute candles
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
          {dayCandleCount} day candles
        </span>
        {!hasLiveCandles ? (
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-amber-200">
            Showing fallback sample candles until live data arrives
          </span>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[20px] border border-white/8 bg-[#08111d] px-4 py-3 text-sm text-slate-300">
        <label className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Amount</span>
          <input
            type="number"
            min={1}
            value={intervalAmount}
            onChange={handleAmountChange}
            className="w-20 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none transition focus:border-cyan-400/40"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Unit</span>
          <select
            value={intervalUnit}
            onChange={handleUnitChange}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none transition focus:border-cyan-400/40"
          >
            <option value="minute">Minutes</option>
            <option value="hour">Hours</option>
            <option value="day">Days</option>
            <option value="week">Weeks</option>
            <option value="month">Months</option>
          </select>
        </label>
        <p className="text-xs text-slate-500">
          Minutes and hours aggregate from 1-minute candles. Days, weeks, and months aggregate from daily candles.
        </p>
      </div>
    </>
  );
}
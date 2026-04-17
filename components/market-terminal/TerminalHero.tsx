'use client';

import type { Market } from '@/src/module_bindings/types';

import {
  formatCompactVolume,
  formatPercent,
  formatPrice,
  formatRate,
  getIntervalLabel,
  type IntervalUnit,
} from '@/lib/market-terminal';

type TerminalHeroProps = {
  market: Market;
  intervalAmount: number;
  intervalUnit: IntervalUnit;
};

export function TerminalHero({ market, intervalAmount, intervalUnit }: TerminalHeroProps) {
  return (
    <div className="border-b border-white/8 px-5 py-4 md:px-6 md:py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Terminal</p>
          <div className="mt-2 flex items-end gap-3">
            <h3 className="text-3xl font-semibold tracking-[-0.03em] text-white md:text-4xl">
              {market.symbol}
            </h3>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-400">
              {market.assetClass}
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-2xl font-medium text-white md:text-3xl">
              {formatPrice(market.price, market.precision)}
            </span>
            <span
              className={`text-sm font-medium ${
                market.change24H >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {formatPercent(market.change24H)} 24h
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
              Quote cadence {market.quoteIntervalMs}ms
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
              Change rate {formatRate(market.changeRate)} per tick
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
              Chart interval {getIntervalLabel(intervalAmount, intervalUnit)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">24h High</div>
            <div className="mt-2 text-sm font-medium text-white">
              {formatPrice(market.high24H, market.precision)}
            </div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">24h Low</div>
            <div className="mt-2 text-sm font-medium text-white">
              {formatPrice(market.low24H, market.precision)}
            </div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">24h Volume</div>
            <div className="mt-2 text-sm font-medium text-white">
              {formatCompactVolume(market.volume24H)}
            </div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Spread</div>
            <div className="mt-2 text-sm font-medium text-white">{market.spreadBps.toFixed(1)} bps</div>
          </div>
        </div>
      </div>
    </div>
  );
}
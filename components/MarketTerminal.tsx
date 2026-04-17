'use client';

import { useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

import {
  aggregateCandles,
  FALLBACK_CANDLES,
  type IntervalUnit,
  type SourceCandle,
  sortByBucketStart,
} from '@/lib/market-terminal';
import { reducers, tables } from '@/src/module_bindings';
import { CandlestickChart } from '@/components/market-terminal/CandlestickChart';
import { ChartToolbar } from '@/components/market-terminal/ChartToolbar';
import { MarketSidebar } from '@/components/market-terminal/MarketSidebar';
import { TerminalHero } from '@/components/market-terminal/TerminalHero';
import { CandlestickData } from 'lightweight-charts';

export default function MarketTerminal() {
  const conn = useSpacetimeDB();
  const [markets, marketsReady] = useTable(tables.market);
  const [minuteCandles, minuteCandlesReady] = useTable(tables.marketMinuteCandle);
  const [dayCandles, dayCandlesReady] = useTable(tables.marketDayCandle);
  const resetSimulation = useReducer(reducers.resetSimulation);
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [intervalAmount, setIntervalAmount] = useState(15);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('minute');

  const sortedMarkets = useMemo(
    () => [...markets].sort((left, right) => left.symbol.localeCompare(right.symbol)),
    [markets]
  );

  const activeMarketId = selectedMarketId ?? sortedMarkets[0]?.id ?? null;
  const selectedMarket =
    sortedMarkets.find(market => market.id === activeMarketId) ?? sortedMarkets[0];
  const safeIntervalAmount = Math.max(1, Math.trunc(intervalAmount) || 1);

  const selectedMinuteCandles = useMemo(() => {
    if (!selectedMarket) {
      return [] as SourceCandle[];
    }

    return minuteCandles
      .filter(candle => candle.marketId === selectedMarket.id)
      .sort(sortByBucketStart);
  }, [minuteCandles, selectedMarket]);

  const selectedDayCandles = useMemo(() => {
    if (!selectedMarket) {
      return [] as SourceCandle[];
    }

    return dayCandles
      .filter(candle => candle.marketId === selectedMarket.id)
      .sort(sortByBucketStart);
  }, [dayCandles, selectedMarket]);

  const selectedCandles = useMemo(() => {
    if (!selectedMarket) {
      return [] as CandlestickData[];
    }

    const sourceRows =
      intervalUnit === 'minute' || intervalUnit === 'hour'
        ? selectedMinuteCandles
        : selectedDayCandles;

    return aggregateCandles(sourceRows, safeIntervalAmount, intervalUnit);
  }, [intervalUnit, safeIntervalAmount, selectedDayCandles, selectedMarket, selectedMinuteCandles]);

  const chartCandles = selectedCandles.length > 0 ? selectedCandles : FALLBACK_CANDLES;
  const isConnected = conn.isActive;
  const hasLiveCandles = selectedCandles.length > 0;

  if (!marketsReady || !minuteCandlesReady || !dayCandlesReady || !selectedMarket) {
    return (
      <div className="flex min-h-155 items-center justify-center rounded-[28px] border border-white/8 bg-[#08111d] text-sm text-slate-400">
        Loading simulated exchange...
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      <MarketSidebar
        markets={sortedMarkets}
        selectedMarketId={selectedMarket.id}
        onSelectMarket={setSelectedMarketId}
        onResetSimulation={() => {
          void resetSimulation();
        }}
      />

      <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_32%),linear-gradient(180deg,#0b1628_0%,#07111d_100%)] shadow-[0_30px_100px_rgba(0,0,0,0.42)]">
        <TerminalHero
          market={selectedMarket}
          intervalAmount={safeIntervalAmount}
          intervalUnit={intervalUnit}
        />

        <div className="px-3 pb-3 pt-2 md:px-4 md:pb-4">
          <ChartToolbar
            isConnected={isConnected}
            minuteCandleCount={selectedMinuteCandles.length}
            dayCandleCount={selectedDayCandles.length}
            hasLiveCandles={hasLiveCandles}
            intervalAmount={safeIntervalAmount}
            intervalUnit={intervalUnit}
            onIntervalAmountChange={setIntervalAmount}
            onIntervalUnitChange={setIntervalUnit}
          />
          <CandlestickChart
            candles={chartCandles}
            precision={selectedMarket.precision}
          />
        </div>
      </section>
    </div>
  );
}
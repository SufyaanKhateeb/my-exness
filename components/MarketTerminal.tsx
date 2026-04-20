'use client';

import { useMemo, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';

import { type IntervalUnit } from '@/lib/market-terminal';
import { LiveMarketChart } from '@/components/market-terminal/LiveMarketChart';
import { LiveOrderBook } from '@/components/market-terminal/LiveOrderBook';
import { LiveMarketSidebar } from '@/components/market-terminal/LiveMarketSidebar';
import { LiveTerminalHero } from '@/components/market-terminal/LiveTerminalHero';
import { reducers, tables } from '@/src/module_bindings';

export default function MarketTerminal() {
  const [markets, marketsReady] = useTable(tables.market);
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
    sortedMarkets.find(market => market.id === activeMarketId) ?? sortedMarkets[0] ?? null;

  if (!marketsReady || !selectedMarket) {
    return (
      <div className="flex min-h-155 items-center justify-center rounded-[28px] border border-white/8 bg-[#08111d] text-sm text-slate-400">
        Loading simulated exchange...
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      <LiveMarketSidebar
        markets={sortedMarkets}
        selectedMarketId={selectedMarket.id}
        onSelectMarket={setSelectedMarketId}
        onResetSimulation={() => {
          void resetSimulation();
        }}
      />

      <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_32%),linear-gradient(180deg,#0b1628_0%,#07111d_100%)] shadow-[0_30px_100px_rgba(0,0,0,0.42)]">
        <LiveTerminalHero
          market={selectedMarket}
          intervalAmount={intervalAmount}
          intervalUnit={intervalUnit}
        />

        <div className="px-3 pb-3 pt-2 md:px-4 md:pb-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
            <LiveMarketChart
              key={`${selectedMarket.id}:${intervalAmount}:${intervalUnit}`}
              marketId={selectedMarket.id}
              precision={selectedMarket.precision}
              intervalAmount={intervalAmount}
              intervalUnit={intervalUnit}
              onIntervalAmountChange={setIntervalAmount}
              onIntervalUnitChange={setIntervalUnit}
            />
            <LiveOrderBook
              key={`order-book:${selectedMarket.id}`}
              marketId={selectedMarket.id}
              precision={selectedMarket.precision}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
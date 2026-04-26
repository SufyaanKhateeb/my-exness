'use client';

import { useMemo, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';

import { type IntervalUnit } from '@/lib/market-terminal';
import { LiveMarketChart } from '@/components/market-terminal/LiveMarketChart';
import { LiveOrderBook } from '@/components/market-terminal/LiveOrderBook';
import { LiveMarketSidebar } from '@/components/market-terminal/LiveMarketSidebar';
import { LivePositionsPanel } from '@/components/market-terminal/LivePositionsPanel';
import { LiveTerminalHero } from '@/components/market-terminal/LiveTerminalHero';
import { LiveTradingTicket } from '@/components/market-terminal/LiveTradingTicket';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { reducers, tables } from '@/src/module_bindings';

export default function MarketTerminal() {
  const [markets, marketsReady] = useTable(tables.market);
  const resetSimulation = useReducer(reducers.resetSimulation);
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [intervalAmount, setIntervalAmount] = useState(1);
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
    <ResizablePanelGroup orientation="horizontal" className="min-h-155">
      <ResizablePanel defaultSize={30} minSize={22}>
        <div className="h-full overflow-hidden">
          <LiveMarketSidebar
            markets={sortedMarkets}
            selectedMarketId={selectedMarket.id}
            onSelectMarket={setSelectedMarketId}
            onResetSimulation={() => {
              void resetSimulation();
            }}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={44} minSize={28}>
        <ResizablePanelGroup orientation="vertical" className="h-full gap-3">
          <ResizablePanel defaultSize={62} minSize={36}>
            <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_32%),linear-gradient(180deg,#0b1628_0%,#07111d_100%)] shadow-[0_30px_100px_rgba(0,0,0,0.42)]">
              <LiveTerminalHero
                market={selectedMarket}
                intervalAmount={intervalAmount}
                intervalUnit={intervalUnit}
              />

              <div className="min-h-0 flex-1 px-3 pb-3 pt-2 md:px-4 md:pb-4">
                <div className="h-full overflow-auto">
                  <LiveMarketChart
                    key={`${selectedMarket.id}:${intervalAmount}:${intervalUnit}`}
                    marketId={selectedMarket.id}
                    precision={selectedMarket.precision}
                    intervalAmount={intervalAmount}
                    intervalUnit={intervalUnit}
                    onIntervalAmountChange={setIntervalAmount}
                    onIntervalUnitChange={setIntervalUnit}
                  />
                </div>
              </div>
            </section>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={38} minSize={22}>
            <div className="h-full overflow-auto">
              <LivePositionsPanel
                key={`positions-panel:${selectedMarket.id}`}
                marketId={selectedMarket.id}
                marketSymbol={selectedMarket.symbol}
                baseAsset={selectedMarket.baseAsset}
                quoteAsset={selectedMarket.quoteAsset}
                precision={selectedMarket.precision}
                quoteIntervalMs={selectedMarket.quoteIntervalMs}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={26} minSize={18}>
        <ResizablePanelGroup orientation="vertical" className="h-full gap-3">
          <ResizablePanel defaultSize={58} minSize={28}>
            <div className="h-full overflow-auto">
              <LiveTradingTicket
                key={`ticket-panel:${selectedMarket.id}`}
                marketId={selectedMarket.id}
                marketSymbol={selectedMarket.symbol}
                baseAsset={selectedMarket.baseAsset}
                quoteAsset={selectedMarket.quoteAsset}
                precision={selectedMarket.precision}
                quoteIntervalMs={selectedMarket.quoteIntervalMs}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel collapsible defaultSize={42} minSize={100}>
            <div className="h-full overflow-auto">
                <LiveOrderBook
                  key={`order-book:${selectedMarket.id}`}
                  marketId={selectedMarket.id}
                  precision={selectedMarket.precision}
                />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
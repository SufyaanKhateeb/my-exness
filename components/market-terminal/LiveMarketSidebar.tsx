'use client';

import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';

import { MarketSidebar, type MarketSidebarItem } from '@/components/market-terminal/MarketSidebar';
import { tables } from '@/src/module_bindings';
import type { Market, MarketOrderBookLevel, MarketPositionState, MarketSnapshot } from '@/src/module_bindings/types';

type LiveMarketSidebarProps = {
  markets: Market[];
  selectedMarketId: number;
  onSelectMarket: (marketId: number) => void;
  onResetSimulation: () => void;
};

export function LiveMarketSidebar({
  markets,
  selectedMarketId,
  onSelectMarket,
  onResetSimulation,
}: LiveMarketSidebarProps) {
  const [snapshots] = useTable(tables.marketSnapshot);
  const [levels] = useTable(tables.marketOrderBookLevel);
  const [positionRows] = useTable(tables.myMarketPositionState);

  const sidebarMarkets = useMemo(() => {
    const snapshotByMarketId = new Map(
      (snapshots as readonly MarketSnapshot[]).map(snapshot => [snapshot.marketId, snapshot])
    );
    const positionByMarketId = new Map(
      (positionRows as readonly MarketPositionState[]).map(position => [position.marketId, position])
    );
    const levelsByMarketId = new Map<number, MarketOrderBookLevel[]>();

    for (const level of levels as readonly MarketOrderBookLevel[]) {
      const marketLevels = levelsByMarketId.get(level.marketId);

      if (marketLevels) {
        marketLevels.push(level);
        continue;
      }

      levelsByMarketId.set(level.marketId, [level]);
    }

    return markets.map(market => {
      const snapshot = snapshotByMarketId.get(market.id);
      const position = positionByMarketId.get(market.id);
      const marketLevels = levelsByMarketId.get(market.id) ?? [];
      const largestBid = marketLevels
        .filter(level => level.isBid)
        .sort((left, right) => right.size - left.size)[0];
      const largestAsk = marketLevels
        .filter(level => !level.isBid)
        .sort((left, right) => right.size - left.size)[0];
      const bid = largestBid?.price ?? snapshot?.price ?? 0;
      const ask = largestAsk?.price ?? snapshot?.price ?? 0;

      return {
        id: market.id,
        symbol: market.symbol,
        assetClass: market.assetClass,
        precision: market.precision,
        bid,
        spread: Math.max(ask - bid, 0),
        ask,
        change24H: snapshot?.change24H ?? 0,
        unrealizedPnl: position?.unrealizedPnl ?? 0,
      } satisfies MarketSidebarItem;
    });
  }, [levels, markets, positionRows, snapshots]);

  return (
    <MarketSidebar
      markets={sidebarMarkets}
      selectedMarketId={selectedMarketId}
      onSelectMarket={onSelectMarket}
      onResetSimulation={onResetSimulation}
    />
  );
}
'use client';

import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';

import { MarketSidebar, type MarketSidebarItem } from '@/components/market-terminal/MarketSidebar';
import { tables } from '@/src/module_bindings';
import type { Market } from '@/src/module_bindings/types';

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

  const sidebarMarkets = useMemo(() => {
    const snapshotByMarketId = new Map(snapshots.map(snapshot => [snapshot.marketId, snapshot]));

    return markets.map(market => {
      const snapshot = snapshotByMarketId.get(market.id);

      return {
        id: market.id,
        symbol: market.symbol,
        assetClass: market.assetClass,
        precision: market.precision,
        price: snapshot?.price ?? 0,
        change24H: snapshot?.change24H ?? 0,
      } satisfies MarketSidebarItem;
    });
  }, [markets, snapshots]);

  return (
    <MarketSidebar
      markets={sidebarMarkets}
      selectedMarketId={selectedMarketId}
      onSelectMarket={onSelectMarket}
      onResetSimulation={onResetSimulation}
    />
  );
}
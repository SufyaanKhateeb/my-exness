'use client';

import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';

import { OrderBookPanel } from '@/components/market-terminal/OrderBookPanel';
import { tables } from '@/src/module_bindings';

type LiveOrderBookProps = {
  marketId: number;
  precision: number;
};

export function LiveOrderBook({ marketId, precision }: LiveOrderBookProps) {
  const [levels, levelsReady] = useTable(
    tables.marketOrderBookLevel.where(level => level.marketId.eq(marketId))
  );

  const { bids, asks, spread } = useMemo(() => {
    const sortedLevels = [...levels].sort((left, right) => left.level - right.level);
    const asks = sortedLevels
      .filter(level => !level.isBid)
      .sort((left, right) => right.price - left.price)
      .reduce<Array<{ level: number; price: number; size: number; total: number }>>((rows, level) => {
        const total = (rows.at(-1)?.total ?? 0) + level.size;
        rows.push({ level: level.level, price: level.price, size: level.size, total });
        return rows;
      }, []);
    const bids = sortedLevels
      .filter(level => level.isBid)
      .sort((left, right) => right.price - left.price)
      .reduce<Array<{ level: number; price: number; size: number; total: number }>>((rows, level) => {
        const total = (rows.at(-1)?.total ?? 0) + level.size;
        rows.push({ level: level.level, price: level.price, size: level.size, total });
        return rows;
      }, []);
    const bestAsk = asks.at(-1)?.price ?? 0;
    const bestBid = bids[0]?.price ?? 0;

    return {
      bids,
      asks,
      spread: Math.max(bestAsk - bestBid, 0),
    };
  }, [levels]);

  if (!levelsReady) {
    return (
      <aside className="rounded-[24px] border border-white/8 bg-[#08111d] p-4 text-sm text-slate-400">
        Loading simulated order book...
      </aside>
    );
  }

  return <OrderBookPanel bids={bids} asks={asks} precision={precision} spread={spread} />;
}
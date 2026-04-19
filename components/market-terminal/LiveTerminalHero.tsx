'use client';

import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';

import {
  TerminalHero,
  type TerminalHeroMarket,
} from '@/components/market-terminal/TerminalHero';
import type { IntervalUnit } from '@/lib/market-terminal';
import { tables } from '@/src/module_bindings';
import type { Market } from '@/src/module_bindings/types';

type LiveTerminalHeroProps = {
  market: Market;
  intervalAmount: number;
  intervalUnit: IntervalUnit;
};

export function LiveTerminalHero({
  market,
  intervalAmount,
  intervalUnit,
}: LiveTerminalHeroProps) {
  const [snapshots, snapshotsReady] = useTable(
    tables.marketSnapshot.where(snapshot => snapshot.marketId.eq(market.id))
  );

  const heroMarket = useMemo(() => {
    const snapshot = snapshots[0];

    if (!snapshot) {
      return null;
    }

    return {
      symbol: market.symbol,
      assetClass: market.assetClass,
      precision: market.precision,
      price: snapshot.price,
      change24H: snapshot.change24H,
      high24H: snapshot.high24H,
      low24H: snapshot.low24H,
      volume24H: snapshot.volume24H,
      spreadBps: market.spreadBps,
      changeRate: market.changeRate,
      quoteIntervalMs: market.quoteIntervalMs,
    } satisfies TerminalHeroMarket;
  }, [market, snapshots]);

  if (!snapshotsReady || !heroMarket) {
    return (
      <div className="border-b border-white/8 px-5 py-4 text-sm text-slate-400 md:px-6 md:py-5">
        Loading market snapshot...
      </div>
    );
  }

  return (
    <TerminalHero
      market={heroMarket}
      intervalAmount={intervalAmount}
      intervalUnit={intervalUnit}
    />
  );
}
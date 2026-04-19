'use client';

import { formatPercent, formatPrice } from '@/lib/market-terminal';

export type MarketSidebarItem = {
  id: number;
  symbol: string;
  assetClass: string;
  precision: number;
  price: number;
  change24H: number;
};

type MarketSidebarProps = {
  markets: MarketSidebarItem[];
  selectedMarketId: number;
  onSelectMarket: (marketId: number) => void;
  onResetSimulation: () => void;
};

export function MarketSidebar({
  markets,
  selectedMarketId,
  onSelectMarket,
  onResetSimulation,
}: MarketSidebarProps) {
  return (
    <section className="rounded-[28px] border border-white/8 bg-[#08111d] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
            Simulated Markets
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">Dummy exchange feed</h2>
        </div>
        <button
          type="button"
          onClick={onResetSimulation}
          className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-400/16"
        >
          Reset tape
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {markets.map(market => {
          const active = market.id === selectedMarketId;
          const positive = market.change24H >= 0;

          return (
            <button
              key={market.id}
              type="button"
              onClick={() => onSelectMarket(market.id)}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                active
                  ? 'border-cyan-400/35 bg-cyan-400/10 shadow-[0_10px_30px_rgba(34,211,238,0.10)]'
                  : 'border-white/6 bg-white/3 hover:border-white/12 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{market.symbol}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.24em] text-slate-500">
                    {market.assetClass}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-white">
                    {formatPrice(market.price, market.precision)}
                  </div>
                  <div
                    className={`mt-1 text-xs font-medium ${
                      positive ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {formatPercent(market.change24H)}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
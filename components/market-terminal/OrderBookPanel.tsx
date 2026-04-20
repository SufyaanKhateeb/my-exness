'use client';

import { formatPrice } from '@/lib/market-terminal';

type OrderBookEntry = {
  level: number;
  price: number;
  size: number;
  total: number;
};

type OrderBookPanelProps = {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  precision: number;
  spread: number;
};

function formatSize(size: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(size);
}

function OrderBookSide({
  entries,
  maxTotal,
  precision,
  tone,
}: {
  entries: OrderBookEntry[];
  maxTotal: number;
  precision: number;
  tone: 'bid' | 'ask';
}) {
  const textClass = tone === 'bid' ? 'text-emerald-300' : 'text-rose-300';
  const barClass = tone === 'bid' ? 'bg-emerald-400/16' : 'bg-rose-400/16';

  return (
    <div className="space-y-1.5">
      {entries.map(entry => {
        const width = maxTotal > 0 ? `${(entry.total / maxTotal) * 100}%` : '0%';

        return (
          <div key={`${tone}:${entry.level}`} className="relative overflow-hidden rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2">
            <div className={`absolute inset-y-0 right-0 ${barClass}`} style={{ width }} />
            <div className="relative grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs">
              <span className={`${textClass} font-medium tabular-nums`}>
                {formatPrice(entry.price, precision)}
              </span>
              <span className="text-slate-300 tabular-nums">{formatSize(entry.size)}</span>
              <span className="text-slate-500 tabular-nums">{formatSize(entry.total)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OrderBookPanel({ bids, asks, precision, spread }: OrderBookPanelProps) {
  const maxTotal = Math.max(
    ...bids.map(entry => entry.total),
    ...asks.map(entry => entry.total),
    0
  );

  return (
    <aside className="rounded-[24px] border border-white/8 bg-[#08111d] p-4 text-slate-300">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Order Book</p>
          <h3 className="mt-1 text-sm font-medium text-white">Simulated market depth</h3>
        </div>
        <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">
          Spread {formatPrice(spread, precision)}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-3 px-1 text-[10px] uppercase tracking-[0.22em] text-slate-500">
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-rose-300/80">Asks</div>
          <OrderBookSide entries={asks} maxTotal={maxTotal} precision={precision} tone="ask" />
        </div>

        <div className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 text-center text-xs text-slate-400">
          Best bid/ask spread: <span className="font-medium text-white">{formatPrice(spread, precision)}</span>
        </div>

        <div>
          <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-emerald-300/80">Bids</div>
          <OrderBookSide entries={bids} maxTotal={maxTotal} precision={precision} tone="bid" />
        </div>
      </div>
    </aside>
  );
}
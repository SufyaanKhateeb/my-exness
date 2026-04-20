'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

import LoginButton from '@/components/LoginButton';
import { formatPrice } from '@/lib/market-terminal';
import { DbConnection, reducers, tables } from '@/src/module_bindings';

const ORDER_SIDE_BUY = 'buy';
const ORDER_SIDE_SELL = 'sell';
const ORDER_TYPE_MARKET = 'market';
const ORDER_TYPE_LIMIT = 'limit';
const ORDER_STATUS_OPEN = 'open';

function formatCurrencyAmount(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

type LiveTradingPanelProps = {
  marketId: number;
  marketSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  precision: number;
  quoteIntervalMs: number;
};

type TradingAccountState = {
  auth0UserId: string;
  currency: string;
  balance: number;
  reservedBalance: number;
  availableBalance: number;
  unrealizedPnl: number;
  netLiquidationValue: number;
  updatedAt: { toMillis(): bigint };
};

type MarketPositionState = {
  marketId: number;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  averageEntryPrice: number;
  markPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  updatedAt: { toMillis(): bigint };
};

type MarketOrderState = {
  id: bigint;
  marketId: number;
  side: string;
  orderType: string;
  status: string;
  quantity: number;
  limitPrice: number | undefined;
  filledPrice: number | undefined;
  createdAt: { toMillis(): bigint };
  updatedAt: { toMillis(): bigint };
  filledAt: { toMillis(): bigint } | undefined;
};

function formatSignedCurrencyAmount(value: number, currency: string) {
  return `${value >= 0 ? '+' : '-'}${formatCurrencyAmount(Math.abs(value), currency)}`;
}

export function LiveTradingPanel({
  marketId,
  marketSymbol,
  baseAsset,
  quoteAsset,
  precision,
}: LiveTradingPanelProps) {
  const { user, isLoading } = useUser();
  const { getConnection, isActive } = useSpacetimeDB();
  const placeMarketOrder = useReducer(reducers.placeMarketOrder);
  const placeLimitOrder = useReducer(reducers.placeLimitOrder);
  const cancelOrder = useReducer(reducers.cancelOrder);
  const [side, setSide] = useState<typeof ORDER_SIDE_BUY | typeof ORDER_SIDE_SELL>(ORDER_SIDE_BUY);
  const [orderType, setOrderType] = useState<typeof ORDER_TYPE_MARKET | typeof ORDER_TYPE_LIMIT>(ORDER_TYPE_MARKET);
  const [quantityInput, setQuantityInput] = useState('');
  const [limitPriceInput, setLimitPriceInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancellingOrderId, setIsCancellingOrderId] = useState<string | null>(null);
  const [hasTradingAccess, setHasTradingAccess] = useState(false);
  const [hasTradingAccessResolved, setHasTradingAccessResolved] = useState(false);
  const [snapshots] = useTable(
    tables.marketSnapshot.where(snapshot => snapshot.marketId.eq(marketId))
  );
  const [accountRows, accountReady] = useTable(tables.myTradingAccountState);
  const [positionRows, positionReady] = useTable(
    tables.myMarketPositionState.where(position => position.marketId.eq(marketId))
  );
  const [ordersRows, ordersReady] = useTable(
    tables.myMarketOrders.where(order => order.marketId.eq(marketId))
  );

  const snapshot = snapshots[0] ?? null;
  const accountState = (accountRows[0] as TradingAccountState | undefined) ?? null;
  const positionState = (positionRows[0] as MarketPositionState | undefined) ?? null;
  const ordersState = ordersRows as readonly MarketOrderState[];
  const recentOrders = ordersState;
  const currency = accountState?.currency ?? quoteAsset;

  useEffect(() => {
    let cancelled = false;

    async function resolveTradingAccess() {
      const conn = getConnection() as DbConnection | null;

      if (!conn || !user?.sub) {
        return;
      }

      try {
        const canTrade = await conn.procedures.currentUserCanTrade({});

        if (cancelled) {
          return;
        }

        setHasTradingAccess(canTrade);
        setHasTradingAccessResolved(true);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load trading access.');
          setHasTradingAccessResolved(true);
        }
      }
    }

    if (!user?.sub) {
      setHasTradingAccess(false);
      setHasTradingAccessResolved(false);
      return () => {
        cancelled = true;
      };
    }

    if (!isActive) {
      return () => {
        cancelled = true;
      };
    }

    void resolveTradingAccess();

    return () => {
      cancelled = true;
    };
  }, [getConnection, isActive, user?.sub]);

  const isTradingStateReady = !user
    ? false
    : hasTradingAccessResolved && accountReady && positionReady && ordersReady;

  async function handleSubmitOrder() {
    setErrorMessage(null);

    const quantity = Number.parseFloat(quantityInput);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setErrorMessage('Enter a valid quantity.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (orderType === ORDER_TYPE_MARKET) {
        await placeMarketOrder({
          marketId,
          side,
          quantity,
        });
      } else {
        const limitPrice = Number.parseFloat(limitPriceInput);

        if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
          setErrorMessage('Enter a valid limit price.');
          return;
        }

        await placeLimitOrder({
          marketId,
          side,
          quantity,
          limitPrice,
        });
      }

      setQuantityInput('');
      if (orderType === ORDER_TYPE_LIMIT) {
        setLimitPriceInput('');
      }

    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Order placement failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancelOrder(orderId: bigint) {
    setErrorMessage(null);
    setIsCancellingOrderId(orderId.toString());

    try {
      await cancelOrder({ orderId });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to cancel order.');
    } finally {
      setIsCancellingOrderId(null);
    }
  }

  if (isLoading) {
    return (
      <aside className="rounded-[24px] border border-white/8 bg-[#08111d] p-4 text-sm text-slate-400">
        Loading account state...
      </aside>
    );
  }

  if (!user) {
    return (
      <aside className="rounded-[24px] border border-white/8 bg-[#08111d] p-4 text-slate-300">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trading</p>
        <h3 className="mt-2 text-sm font-medium text-white">Sign in to place orders</h3>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Authentication unlocks your simulated cash balance, positions, and order ticket.
        </p>
        <div className="mt-4">
          <LoginButton />
        </div>
      </aside>
    );
  }

  if (!isTradingStateReady) {
    return (
      <aside className="rounded-[24px] border border-white/8 bg-[#08111d] p-4 text-sm text-slate-400">
        Preparing your trading account...
      </aside>
    );
  }

  if (!hasTradingAccess || !accountState) {
    return (
      <aside className="rounded-[24px] border border-white/8 bg-[#08111d] p-4 text-slate-300">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trading</p>
        <h3 className="mt-2 text-sm font-medium text-white">Trading access unavailable</h3>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Your Auth0 session is valid, but no trade-enabled account state is available in SpacetimeDB yet.
        </p>
        {errorMessage ? (
          <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="rounded-[24px] border border-white/8 bg-[#08111d] p-4 text-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trading</p>
          <h3 className="mt-1 text-sm font-medium text-white">{marketSymbol} ticket</h3>
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
          Last {snapshot ? formatPrice(snapshot.price, precision) : '--'}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Balance</div>
          <div className="mt-2 text-sm font-medium text-white">
            {formatCurrencyAmount(accountState.balance, currency)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Available</div>
          <div className="mt-2 text-sm font-medium text-white">
            {formatCurrencyAmount(accountState.availableBalance, currency)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Net Value</div>
          <div className="mt-2 text-sm font-medium text-white">
            {formatCurrencyAmount(accountState.netLiquidationValue, currency)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Unrealized</div>
          <div className="mt-2 text-sm font-medium text-white">
            <span className={accountState.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
              {formatSignedCurrencyAmount(accountState.unrealizedPnl, currency)}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 col-span-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Position</div>
          <div className="mt-2 text-sm font-medium text-white">
            {(positionState?.availableQuantity ?? 0).toFixed(4)} {baseAsset}
          </div>
          {positionState && positionState.quantity > 0 ? (
            <div className="mt-1 text-xs text-slate-500">
              Avg {formatPrice(positionState.averageEntryPrice, precision)} | Mark {formatPrice(positionState.markPrice, precision)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex gap-2 rounded-2xl border border-white/8 bg-white/3 p-1">
        <button
          type="button"
          className={`flex-1 rounded-xl px-3 py-2 text-sm transition ${
            orderType === ORDER_TYPE_MARKET
              ? 'bg-cyan-400/15 text-cyan-100'
              : 'text-slate-400 hover:text-white'
          }`}
          onClick={() => setOrderType(ORDER_TYPE_MARKET)}
        >
          Market
        </button>
        <button
          type="button"
          className={`flex-1 rounded-xl px-3 py-2 text-sm transition ${
            orderType === ORDER_TYPE_LIMIT
              ? 'bg-cyan-400/15 text-cyan-100'
              : 'text-slate-400 hover:text-white'
          }`}
          onClick={() => setOrderType(ORDER_TYPE_LIMIT)}
        >
          Limit
        </button>
      </div>

      <div className="mt-3 flex gap-2 rounded-2xl border border-white/8 bg-white/3 p-1">
        <button
          type="button"
          className={`flex-1 rounded-xl px-3 py-2 text-sm transition ${
            side === ORDER_SIDE_BUY
              ? 'bg-emerald-400/15 text-emerald-100'
              : 'text-slate-400 hover:text-white'
          }`}
          onClick={() => setSide(ORDER_SIDE_BUY)}
        >
          Buy
        </button>
        <button
          type="button"
          className={`flex-1 rounded-xl px-3 py-2 text-sm transition ${
            side === ORDER_SIDE_SELL
              ? 'bg-rose-400/15 text-rose-100'
              : 'text-slate-400 hover:text-white'
          }`}
          onClick={() => setSide(ORDER_SIDE_SELL)}
        >
          Sell
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Quantity ({baseAsset})
          </span>
          <input
            type="number"
            min="0"
            step="any"
            value={quantityInput}
            onChange={event => setQuantityInput(event.target.value)}
            className="w-full rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
            placeholder={`0.00 ${baseAsset}`}
          />
        </label>

        {orderType === ORDER_TYPE_LIMIT ? (
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-500">
              Limit price ({currency})
            </span>
            <input
              type="number"
              min="0"
              step="any"
              value={limitPriceInput}
              onChange={event => setLimitPriceInput(event.target.value)}
              className="w-full rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
              placeholder={snapshot ? formatPrice(snapshot.price, precision) : '0.00'}
            />
          </label>
        ) : null}
      </div>

      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => {
          void handleSubmitOrder();
        }}
        className={`mt-4 w-full rounded-2xl px-4 py-3 text-sm font-medium transition ${
          side === ORDER_SIDE_BUY
            ? 'bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/20'
            : 'bg-rose-400/15 text-rose-100 hover:bg-rose-400/20'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {isSubmitting ? 'Submitting...' : `${side === ORDER_SIDE_BUY ? 'Buy' : 'Sell'} ${orderType}`}
      </button>

      {errorMessage ? (
        <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Recent orders</div>
          <div className="text-[11px] text-slate-500">{recentOrders.length}</div>
        </div>

        {recentOrders.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-slate-500">
            No orders for this market yet.
          </div>
        ) : (
          <div className="space-y-2">
            {recentOrders.slice(0, 6).map(order => {
              const isOpen = order.status === ORDER_STATUS_OPEN;
              const sideClass = order.side === ORDER_SIDE_BUY ? 'text-emerald-300' : 'text-rose-300';
              const actionLabel = `${order.side === ORDER_SIDE_BUY ? 'Buy' : 'Sell'} ${order.quantity.toFixed(4)} ${baseAsset}`;
              const priceLabel = order.orderType === ORDER_TYPE_LIMIT
                ? `@ ${formatPrice(order.limitPrice ?? 0, precision)}`
                : order.filledPrice != null
                  ? `@ ${formatPrice(order.filledPrice, precision)}`
                  : 'at market';

              return (
                <div key={order.id.toString()} className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={`text-sm font-medium ${sideClass}`}>{actionLabel}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {order.orderType} {priceLabel}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {order.status}
                      </div>
                      {isOpen ? (
                        <button
                          type="button"
                          disabled={isCancellingOrderId === order.id.toString()}
                          onClick={() => {
                            void handleCancelOrder(order.id);
                          }}
                          className="mt-2 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-rose-400/30 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isCancellingOrderId === order.id.toString() ? 'Cancelling...' : 'Cancel'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

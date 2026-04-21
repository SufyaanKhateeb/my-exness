'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

import LoginButton from '@/components/LoginButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatPrice } from '@/lib/market-terminal';
import { DbConnection, reducers, tables } from '@/src/module_bindings';

const ORDER_SIDE_BUY = 'buy';
const ORDER_SIDE_SELL = 'sell';
const ORDER_TYPE_MARKET = 'market';
const ORDER_TYPE_LIMIT = 'limit';
const ORDER_STATUS_OPEN = 'open';
const PRICE_ALERT_REFERENCE_BID = 'bid';
const PRICE_ALERT_REFERENCE_ASK = 'ask';
const PRICE_ALERT_STATUS_ACTIVE = 'active';
const PRICE_ALERT_STATUS_TRIGGERED = 'triggered';

function getDefaultTradeQuantity(baseAsset: string) {
  if (baseAsset === 'BTC' || baseAsset === 'ETH') {
    return '0.01';
  }

  if (baseAsset === 'SOL') {
    return '1';
  }

  if (baseAsset === 'XAU') {
    return '1';
  }

  if (baseAsset === 'EUR') {
    return '1000';
  }

  return '1';
}

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
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  accountLeverage: number;
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

type MarketOrderBookLevel = {
  id: bigint;
  marketId: number;
  isBid: boolean;
  level: number;
  price: number;
  size: number;
  updatedAt: { toMillis(): bigint };
};

type PriceAlertState = {
  id: bigint;
  auth0UserId: string;
  marketId: number;
  triggerPrice: number;
  referencePriceKind: string;
  triggerDirection: string;
  status: string;
  expiresAt: { toMillis(): bigint };
  triggeredAt: { toMillis(): bigint } | undefined;
  triggeredPrice: number | undefined;
  createdAt: { toMillis(): bigint };
  updatedAt: { toMillis(): bigint };
};

type PositionHistoryState = {
  id: bigint;
  orderId: bigint;
  auth0UserId: string;
  marketId: number;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  closedAt: { toMillis(): bigint };
};

function formatSignedCurrencyAmount(value: number, currency: string) {
  return `${value >= 0 ? '+' : '-'}${formatCurrencyAmount(Math.abs(value), currency)}`;
}

function formatPercentAmount(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatAlertReference(referencePriceKind: string) {
  return referencePriceKind === PRICE_ALERT_REFERENCE_BID ? 'Bid' : 'Ask';
}

function formatAlertStatus(status: string) {
  if (status === PRICE_ALERT_STATUS_ACTIVE) {
    return 'Active';
  }

  if (status === PRICE_ALERT_STATUS_TRIGGERED) {
    return 'Triggered';
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatAlertTimestamp(timestamp: { toMillis(): bigint } | undefined) {
  if (!timestamp) {
    return 'Pending';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(Number(timestamp.toMillis()));
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
  const createPriceAlert = useReducer(reducers.createPriceAlert);
  const deletePriceAlert = useReducer(reducers.deletePriceAlert);
  const [side, setSide] = useState<typeof ORDER_SIDE_BUY | typeof ORDER_SIDE_SELL>(ORDER_SIDE_BUY);
  const [orderType, setOrderType] = useState<typeof ORDER_TYPE_MARKET | typeof ORDER_TYPE_LIMIT>(ORDER_TYPE_MARKET);
  const [quantityInput, setQuantityInput] = useState(() => getDefaultTradeQuantity(baseAsset));
  const [limitPriceInput, setLimitPriceInput] = useState('');
  const [alertPriceInput, setAlertPriceInput] = useState('');
  const [positionTab, setPositionTab] = useState('open');
  const [isModifyDialogOpen, setIsModifyDialogOpen] = useState(false);
  const [partialCloseInput, setPartialCloseInput] = useState(() => getDefaultTradeQuantity(baseAsset));
  const [alertReferenceKind, setAlertReferenceKind] = useState<
    typeof PRICE_ALERT_REFERENCE_BID | typeof PRICE_ALERT_REFERENCE_ASK
  >(PRICE_ALERT_REFERENCE_BID);
  const [alertExpiryDays, setAlertExpiryDays] = useState<1 | 5 | 15 | 30>(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingAlert, setIsCreatingAlert] = useState(false);
  const [isCancellingOrderId, setIsCancellingOrderId] = useState<string | null>(null);
  const [isDeletingAlertId, setIsDeletingAlertId] = useState<string | null>(null);
  const [hasTradingAccess, setHasTradingAccess] = useState(false);
  const [hasTradingAccessResolved, setHasTradingAccessResolved] = useState(false);
  const [snapshots] = useTable(
    tables.marketSnapshot.where(snapshot => snapshot.marketId.eq(marketId))
  );
  const [levels, levelsReady] = useTable(
    tables.marketOrderBookLevel.where(level => level.marketId.eq(marketId))
  );
  const [accountRows, accountReady] = useTable(tables.myTradingAccountState);
  const [positionRows, positionReady] = useTable(
    tables.myMarketPositionState.where(position => position.marketId.eq(marketId))
  );
  const [ordersRows, ordersReady] = useTable(
    tables.myMarketOrders.where(order => order.marketId.eq(marketId))
  );
  const [positionHistoryRows, positionHistoryReady] = useTable(
    tables.myPositionHistory.where(positionHistory => positionHistory.marketId.eq(marketId))
  );
  const [priceAlertRows, priceAlertsReady] = useTable(tables.myPriceAlerts);

  const snapshot = snapshots[0] ?? null;
  const accountState = (accountRows[0] as TradingAccountState | undefined) ?? null;
  const positionState = (positionRows[0] as MarketPositionState | undefined) ?? null;
  const ordersState = ordersRows as readonly MarketOrderState[];
  const positionHistoryState = positionHistoryRows as readonly PositionHistoryState[];
  const priceAlerts = priceAlertRows as readonly PriceAlertState[];
  const currency = accountState?.currency ?? quoteAsset;
  const defaultTradeQuantity = useMemo(() => getDefaultTradeQuantity(baseAsset), [baseAsset]);
  const marketAlerts = useMemo(
    () => priceAlerts.filter(alert => alert.marketId === marketId),
    [marketId, priceAlerts]
  );
  const pendingOrders = useMemo(
    () => ordersState.filter(order => order.status === ORDER_STATUS_OPEN),
    [ordersState]
  );
  const { bestBid, bestAsk } = useMemo(() => {
    const orderBookLevels = levels as readonly MarketOrderBookLevel[];
    const bid = orderBookLevels
      .filter(level => level.isBid)
      .sort((left, right) => right.price - left.price)[0]?.price;
    const ask = orderBookLevels
      .filter(level => !level.isBid)
      .sort((left, right) => left.price - right.price)[0]?.price;

    return {
      bestBid: bid ?? snapshot?.price ?? 0,
      bestAsk: ask ?? snapshot?.price ?? 0,
    };
  }, [levels, snapshot?.price]);

  useEffect(() => {
    setQuantityInput(defaultTradeQuantity);
    setPartialCloseInput(defaultTradeQuantity);
  }, [defaultTradeQuantity, marketId]);

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
    : hasTradingAccessResolved && accountReady && positionReady && ordersReady && positionHistoryReady && priceAlertsReady && levelsReady;

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
      setQuantityInput(defaultTradeQuantity);

    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Order placement failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCloseOpenPosition(quantity: number) {
    setErrorMessage(null);

    if (!positionState || positionState.availableQuantity <= 0) {
      setErrorMessage('No open position is available to close.');
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setErrorMessage('Enter a valid quantity to close.');
      return;
    }

    if (quantity > positionState.availableQuantity) {
      setErrorMessage('Close quantity cannot exceed the open position size.');
      return;
    }

    setIsSubmitting(true);

    try {
      await placeMarketOrder({
        marketId,
        side: ORDER_SIDE_SELL,
        quantity,
      });
      setIsModifyDialogOpen(false);
      setPartialCloseInput(defaultTradeQuantity);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to close position.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitPartialClose() {
    const quantity = Number.parseFloat(partialCloseInput);
    await handleCloseOpenPosition(quantity);
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

  async function handleCreatePriceAlert() {
    setErrorMessage(null);

    const triggerPrice = Number.parseFloat(alertPriceInput);

    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
      setErrorMessage('Enter a valid alert price.');
      return;
    }

    setIsCreatingAlert(true);

    try {
      await createPriceAlert({
        marketId,
        triggerPrice,
        referencePriceKind: alertReferenceKind,
        expiryDays: alertExpiryDays,
      });
      setAlertPriceInput('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create price alert.');
    } finally {
      setIsCreatingAlert(false);
    }
  }

  async function handleDeletePriceAlert(alertId: bigint) {
    setErrorMessage(null);
    setIsDeletingAlertId(alertId.toString());

    try {
      await deletePriceAlert({ alertId });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete price alert.');
    } finally {
      setIsDeletingAlertId(null);
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
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Equity</div>
          <div className="mt-2 text-sm font-medium text-white">
            {formatCurrencyAmount(accountState.equity, currency)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Margin</div>
          <div className="mt-2 text-sm font-medium text-white">
            {formatCurrencyAmount(accountState.margin, currency)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Free Margin</div>
          <div className="mt-2 text-sm font-medium text-white">
            {formatCurrencyAmount(accountState.freeMargin, currency)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Margin Level</div>
          <div className="mt-2 text-sm font-medium text-white">
            {accountState.margin > 0 ? formatPercentAmount(accountState.marginLevel) : '—'}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Leverage</div>
          <div className="mt-2 text-sm font-medium text-white">1:{accountState.accountLeverage}</div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Unrealized</div>
          <div className="mt-2 text-sm font-medium text-white">
            <span className={accountState.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
              {formatSignedCurrencyAmount(accountState.unrealizedPnl, currency)}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Order Reserve</div>
          <div className="mt-2 text-sm font-medium text-white">
            {formatCurrencyAmount(accountState.reservedBalance, currency)}
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

      <div className="mt-5 rounded-2xl border border-white/8 bg-white/3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Price alerts</div>
            <div className="mt-1 text-xs text-slate-500">
              Bid {formatPrice(bestBid, precision)} · Ask {formatPrice(bestAsk, precision)}
            </div>
          </div>
          <div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-400">
            {marketAlerts.length} total
          </div>
        </div>

        <div className="mt-3 grid gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-500">
              Trigger price ({currency})
            </span>
            <input
              type="number"
              min="0"
              step="any"
              value={alertPriceInput}
              onChange={event => setAlertPriceInput(event.target.value)}
              className="w-full rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
              placeholder={snapshot ? formatPrice(snapshot.price, precision) : '0.00'}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-500">
                Reference
              </span>
              <select
                value={alertReferenceKind}
                onChange={event => setAlertReferenceKind(event.target.value as typeof PRICE_ALERT_REFERENCE_BID | typeof PRICE_ALERT_REFERENCE_ASK)}
                className="w-full rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
              >
                <option value={PRICE_ALERT_REFERENCE_BID}>Bid price</option>
                <option value={PRICE_ALERT_REFERENCE_ASK}>Ask price</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-500">
                Expiry
              </span>
              <select
                value={alertExpiryDays}
                onChange={event => setAlertExpiryDays(Number.parseInt(event.target.value, 10) as 1 | 5 | 15 | 30)}
                className="w-full rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
              >
                <option value={1}>1 day</option>
                <option value={5}>5 days</option>
                <option value={15}>15 days</option>
                <option value={30}>30 days</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            disabled={isCreatingAlert}
            onClick={() => {
              void handleCreatePriceAlert();
            }}
            className="w-full rounded-2xl bg-amber-300/14 px-4 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreatingAlert ? 'Creating alert...' : 'Create price alert'}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {marketAlerts.length === 0 ? (
            <div className="rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3 text-sm text-slate-500">
              No alerts for this market yet.
            </div>
          ) : (
            marketAlerts.slice(0, 6).map(alert => {
              const isActive = alert.status === PRICE_ALERT_STATUS_ACTIVE;
              const isTriggered = alert.status === PRICE_ALERT_STATUS_TRIGGERED;

              return (
                <div key={alert.id.toString()} className="rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {formatAlertReference(alert.referencePriceKind)} {formatPrice(alert.triggerPrice, precision)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Triggers on {alert.triggerDirection} move · Expires {formatAlertTimestamp(alert.expiresAt)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {isTriggered && alert.triggeredPrice != null
                          ? `Triggered at ${formatPrice(alert.triggeredPrice, precision)} on ${formatAlertTimestamp(alert.triggeredAt)}`
                          : `Watching ${formatAlertReference(alert.referencePriceKind).toLowerCase()} price`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[11px] uppercase tracking-[0.18em] ${isTriggered ? 'text-amber-200' : isActive ? 'text-cyan-200' : 'text-slate-500'}`}>
                        {formatAlertStatus(alert.status)}
                      </div>
                      <button
                        type="button"
                        disabled={isDeletingAlertId === alert.id.toString()}
                        onClick={() => {
                          void handleDeletePriceAlert(alert.id);
                        }}
                        className="mt-2 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-rose-400/30 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isDeletingAlertId === alert.id.toString() ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-white/8 bg-white/3 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Positions</div>
          <div className="text-[11px] text-slate-500">
            {positionState && positionState.availableQuantity > 0 ? '1 open' : 'No open position'}
          </div>
        </div>

        <Tabs value={positionTab} onValueChange={setPositionTab} className="gap-3">
          <TabsList className="w-full bg-[#08111d]">
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="space-y-2">
            {positionState && positionState.availableQuantity > 0 ? (
              <div className="rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">
                      {positionState.availableQuantity.toFixed(4)} {baseAsset}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Avg {formatPrice(positionState.averageEntryPrice, precision)} · Mark {formatPrice(positionState.markPrice, precision)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Unrealized {formatSignedCurrencyAmount(positionState.unrealizedPnl, currency)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        void handleCloseOpenPosition(positionState.availableQuantity);
                      }}
                      className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-[11px] text-rose-100 transition hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? 'Closing...' : 'Close position'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPartialCloseInput(
                          Math.min(Number.parseFloat(defaultTradeQuantity), positionState.availableQuantity).toString()
                        );
                        setIsModifyDialogOpen(true);
                      }}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 transition hover:border-cyan-400/30 hover:text-cyan-100"
                    >
                      Modify position
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3 text-sm text-slate-500">
                No open positions for this market.
              </div>
            )}
          </TabsContent>

          <TabsContent value="pending" className="space-y-2">
            {pendingOrders.length === 0 ? (
              <div className="rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3 text-sm text-slate-500">
                No pending orders for this market.
              </div>
            ) : (
              pendingOrders.slice(0, 6).map(order => {
                const sideClass = order.side === ORDER_SIDE_BUY ? 'text-emerald-300' : 'text-rose-300';

                return (
                  <div key={order.id.toString()} className="rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className={`text-sm font-medium ${sideClass}`}>
                          {order.side === ORDER_SIDE_BUY ? 'Buy' : 'Sell'} {order.quantity.toFixed(4)} {baseAsset}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {order.orderType} @ {formatPrice(order.limitPrice ?? snapshot?.price ?? 0, precision)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isCancellingOrderId === order.id.toString()}
                        onClick={() => {
                          void handleCancelOrder(order.id);
                        }}
                        className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-rose-400/30 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isCancellingOrderId === order.id.toString() ? 'Cancelling...' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="closed" className="space-y-2">
            {positionHistoryState.length === 0 ? (
              <div className="rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3 text-sm text-slate-500">
                No closed history for this market yet.
              </div>
            ) : (
              positionHistoryState.slice(0, 6).map(positionHistory => {
                const realizedPnlClass = positionHistory.realizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300';

                return (
                  <div key={positionHistory.id.toString()} className="rounded-2xl border border-white/8 bg-[#08111d] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">
                          Closed {positionHistory.quantity.toFixed(4)} {baseAsset}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Entry {formatPrice(positionHistory.entryPrice, precision)} · Exit {formatPrice(positionHistory.exitPrice, precision)}
                        </div>
                        <div className={`mt-1 text-xs ${realizedPnlClass}`}>
                          Realized {formatSignedCurrencyAmount(positionHistory.realizedPnl, currency)}
                        </div>
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {formatAlertTimestamp(positionHistory.closedAt)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </div>

      {isModifyDialogOpen && positionState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#08111d] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.42)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Modify position</div>
                <div className="mt-1 text-sm font-medium text-white">Partial close {marketSymbol}</div>
              </div>
              <button
                type="button"
                onClick={() => setIsModifyDialogOpen(false)}
                className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 transition hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-xs text-slate-400">
                Open size {positionState.availableQuantity.toFixed(4)} {baseAsset} · Mark {formatPrice(positionState.markPrice, precision)}
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Close quantity ({baseAsset})
                </span>
                <input
                  type="number"
                  min="0"
                  max={positionState.availableQuantity}
                  step="any"
                  value={partialCloseInput}
                  onChange={event => setPartialCloseInput(event.target.value)}
                  className="w-full rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                  placeholder={defaultTradeQuantity}
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setIsModifyDialogOpen(false)}
                className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-300 transition hover:text-white"
              >
                Keep open
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  void handleSubmitPartialClose();
                }}
                className="flex-1 rounded-2xl bg-rose-400/15 px-4 py-3 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Closing...' : 'Sell to close'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

import LoginButton from '@/components/LoginButton';
import { type TradingPanelProps } from '@/components/market-terminal/trading-panel.types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPrice } from '@/lib/market-terminal';
import { DbConnection, reducers, tables } from '@/src/module_bindings';

const ORDER_SIDE_BUY = 'buy';
const ORDER_SIDE_SELL = 'sell';
const ORDER_EXECUTION_TYPE_OPEN = 'open';
const ORDER_STATUS_OPEN = 'open';

type TradingAccountState = {
  currency: string;
};

type MarketPositionState = {
  marketId: number;
  quantity: number;
  availableQuantity: number;
  averageEntryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
};

type MarketOrderState = {
  id: bigint;
  marketId: number;
  side: string;
  executionType: string;
  orderType: string;
  status: string;
  quantity: number;
  limitPrice: number | undefined;
};

type PositionHistoryState = {
  id: bigint;
  marketId: number;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  closedAt: { toMillis(): bigint };
};

type OpenPositionLotState = {
  id: bigint;
  marketId: number;
  side: string;
  quantity: number;
  openPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  openedAt: { toMillis(): bigint };
};

type MarketSnapshotState = {
  price: number;
};

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

function formatSignedCurrencyAmount(value: number, currency: string) {
  return `${value >= 0 ? '+' : '-'}${formatCurrencyAmount(Math.abs(value), currency)}`;
}

function formatTimestamp(timestamp: { toMillis(): bigint } | undefined) {
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

export function LivePositionsPanel({
  marketId,
  marketSymbol,
  baseAsset,
  quoteAsset,
  precision,
}: TradingPanelProps) {
  const { user, isLoading } = useUser();
  const { getConnection, isActive } = useSpacetimeDB();
  const closeMarketPosition = useReducer(reducers.closeMarketPosition);
  const cancelOrder = useReducer(reducers.cancelOrder);
  const [positionTab, setPositionTab] = useState('open');
  const [showGroupedPositions, setShowGroupedPositions] = useState(false);
  const [isModifyDialogOpen, setIsModifyDialogOpen] = useState(false);
  const [partialCloseInput, setPartialCloseInput] = useState(() => getDefaultTradeQuantity(baseAsset));
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
  const [openPositionLotRows, openPositionLotsReady] = useTable(
    tables.myOpenPositionLots.where(positionLot => positionLot.marketId.eq(marketId))
  );
  const [positionHistoryRows, positionHistoryReady] = useTable(
    tables.myPositionHistory.where(positionHistory => positionHistory.marketId.eq(marketId))
  );

  const snapshot = (snapshots[0] as MarketSnapshotState | undefined) ?? null;
  const accountState = (accountRows[0] as TradingAccountState | undefined) ?? null;
  const positionState = (positionRows[0] as MarketPositionState | undefined) ?? null;
  const ordersState = ordersRows as readonly MarketOrderState[];
  const openPositionLots = openPositionLotRows as readonly OpenPositionLotState[];
  const positionHistoryState = positionHistoryRows as readonly PositionHistoryState[];
  const currency = accountState?.currency ?? quoteAsset;
  const defaultTradeQuantity = useMemo(() => getDefaultTradeQuantity(baseAsset), [baseAsset]);
  const pendingOrders = useMemo(
    () => ordersState.filter(order => order.status === ORDER_STATUS_OPEN),
    [ordersState]
  );
  const groupedPositionSide = positionState
    ? positionState.quantity >= 0
      ? ORDER_SIDE_BUY
      : ORDER_SIDE_SELL
    : ORDER_SIDE_BUY;
  const groupedOpenPositionOpenedAt = useMemo(() => {
    if (openPositionLots.length === 0) {
      return undefined;
    }

    return openPositionLots.reduce((earliest, lot) => {
      if (!earliest) {
        return lot.openedAt;
      }

      return lot.openedAt.toMillis() < earliest.toMillis() ? lot.openedAt : earliest;
    }, undefined as OpenPositionLotState['openedAt'] | undefined);
  }, [openPositionLots]);

  useEffect(() => {
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
    : hasTradingAccessResolved && accountReady && positionReady && ordersReady && openPositionLotsReady && positionHistoryReady;

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
      await closeMarketPosition({ marketId, quantity });
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

  if (isLoading) {
    return (
      <Card className="rounded-[24px] border-white/8 bg-[#08111d] text-slate-300 shadow-none">
        <CardContent className="p-4 text-sm text-slate-400">
          <div className="flex items-center gap-3">
            <Spinner className="size-4" />
            <span>Loading account state...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="rounded-[24px] border-white/8 bg-[#08111d] text-slate-300 shadow-none">
        <CardHeader className="p-4 pb-0">
          <CardTitle className="text-sm font-medium text-white">Sign in to view positions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <p className="text-sm leading-6 text-slate-400">
            Authentication unlocks your simulated open positions, pending orders, and closed history.
          </p>
          <LoginButton />
        </CardContent>
      </Card>
    );
  }

  if (!isTradingStateReady) {
    return (
      <Card className="rounded-[24px] border-white/8 bg-[#08111d] text-slate-300 shadow-none">
        <CardContent className="p-4 text-sm text-slate-400">
          <div className="flex items-center gap-3">
            <Spinner className="size-4" />
            <span>Preparing your trading account...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasTradingAccess || !accountState) {
    return (
      <Card className="rounded-[24px] border-white/8 bg-[#08111d] text-slate-300 shadow-none">
        <CardHeader className="p-4 pb-0">
          <CardTitle className="text-sm font-medium text-white">Position data unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm leading-6 text-slate-400">
            Your Auth0 session is valid, but position state for this account is not available in SpacetimeDB yet.
          </p>
          {errorMessage ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
              {errorMessage}
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-transparent border-none text-slate-300 shadow-none">
        <CardHeader className="p-4 pb-0">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium text-white">Positions</CardTitle>
            <span className="text-[11px] text-slate-500">
              {positionState && positionState.availableQuantity > 0 ? '1 open' : 'No open position'}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 p-4">
          {errorMessage ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
              {errorMessage}
            </div>
          ) : null}

          <Tabs value={positionTab} onValueChange={setPositionTab} className="gap-3">
            <TabsList className="w-full">
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="closed">Closed</TabsTrigger>
            </TabsList>

            <TabsContent value="open" className="space-y-2">
              {positionState && positionState.availableQuantity > 0 ? (
                <div className="space-y-3 rounded-2xl border border-white/8 bg-white/3 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      {showGroupedPositions
                        ? `Grouped ${openPositionLots.length} open trade${openPositionLots.length === 1 ? '' : 's'}`
                        : `Showing ${openPositionLots.length} individual trade${openPositionLots.length === 1 ? '' : 's'}`}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowGroupedPositions(current => !current)}>
                        {showGroupedPositions ? 'Show individual positions' : 'Group positions'}
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="bg-rose-400/15 text-rose-100 hover:bg-rose-400/20"
                        disabled={isSubmitting}
                        onClick={() => {
                          void handleCloseOpenPosition(positionState.availableQuantity);
                        }}
                      >
                        {isSubmitting ? 'Closing...' : 'Close grouped'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPartialCloseInput(
                            Math.min(Number.parseFloat(defaultTradeQuantity), positionState.availableQuantity).toString()
                          );
                          setIsModifyDialogOpen(true);
                        }}
                      >
                        Modify grouped
                      </Button>
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Volume</TableHead>
                        <TableHead className="text-right">Open Price</TableHead>
                        <TableHead className="text-right">Current Price</TableHead>
                        <TableHead>Open Time</TableHead>
                        <TableHead className="text-right">P/L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {showGroupedPositions ? (
                        <TableRow>
                          <TableCell>{marketSymbol}</TableCell>
                          <TableCell className={groupedPositionSide === ORDER_SIDE_BUY ? 'text-emerald-300' : 'text-rose-300'}>
                            {groupedPositionSide}
                          </TableCell>
                          <TableCell className="text-right">{positionState.availableQuantity.toFixed(4)}</TableCell>
                          <TableCell className="text-right">{formatPrice(positionState.averageEntryPrice, precision)}</TableCell>
                          <TableCell className="text-right">{formatPrice(positionState.markPrice, precision)}</TableCell>
                          <TableCell>{formatTimestamp(groupedOpenPositionOpenedAt)}</TableCell>
                          <TableCell className={`text-right ${positionState.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {formatSignedCurrencyAmount(positionState.unrealizedPnl, currency)}
                          </TableCell>
                        </TableRow>
                      ) : (
                        openPositionLots.map(positionLot => (
                          <TableRow key={positionLot.id.toString()}>
                            <TableCell>{marketSymbol}</TableCell>
                            <TableCell className={positionLot.side === ORDER_SIDE_BUY ? 'text-emerald-300' : 'text-rose-300'}>
                              {positionLot.side}
                            </TableCell>
                            <TableCell className="text-right">{positionLot.quantity.toFixed(4)}</TableCell>
                            <TableCell className="text-right">{formatPrice(positionLot.openPrice, precision)}</TableCell>
                            <TableCell className="text-right">{formatPrice(positionLot.currentPrice, precision)}</TableCell>
                            <TableCell>{formatTimestamp(positionLot.openedAt)}</TableCell>
                            <TableCell className={`text-right ${positionLot.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {formatSignedCurrencyAmount(positionLot.unrealizedPnl, currency)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-slate-500">
                  No open positions for this market.
                </div>
              )}
            </TabsContent>

            <TabsContent value="pending" className="space-y-2">
              {pendingOrders.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-slate-500">
                  No pending orders for this market.
                </div>
              ) : (
                pendingOrders.slice(0, 6).map(order => {
                  const sideClass = order.side === ORDER_SIDE_BUY ? 'text-emerald-300' : 'text-rose-300';

                  return (
                    <div key={order.id.toString()} className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className={`text-sm font-medium ${sideClass}`}>
                            {order.executionType === ORDER_EXECUTION_TYPE_OPEN ? 'Open' : 'Close'} {order.side === ORDER_SIDE_BUY ? 'Buy' : 'Sell'} {order.quantity.toFixed(4)} {baseAsset}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {order.orderType} @ {formatPrice(order.limitPrice ?? snapshot?.price ?? 0, precision)}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isCancellingOrderId === order.id.toString()}
                          onClick={() => {
                            void handleCancelOrder(order.id);
                          }}
                        >
                          {isCancellingOrderId === order.id.toString() ? 'Cancelling...' : 'Cancel'}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="closed" className="space-y-2">
              {positionHistoryState.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-slate-500">
                  No closed history for this market yet.
                </div>
              ) : (
                positionHistoryState.slice(0, 6).map(positionHistory => {
                  const realizedPnlClass = positionHistory.realizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300';

                  return (
                    <div key={positionHistory.id.toString()} className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
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
                          {formatTimestamp(positionHistory.closedAt)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {isModifyDialogOpen && positionState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <Card className="w-full max-w-md rounded-[24px] border-white/10 bg-[#08111d] text-slate-300 shadow-[0_30px_100px_rgba(0,0,0,0.42)]">
            <CardHeader className="p-4 pb-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-medium text-white">Partial close {marketSymbol}</CardTitle>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setIsModifyDialogOpen(false)}>
                  Close
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 p-4">
              <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-xs text-slate-400">
                Open size {positionState.availableQuantity.toFixed(4)} {baseAsset} · Mark {formatPrice(positionState.markPrice, precision)}
              </div>

              <div className="space-y-2">
                <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Close quantity ({baseAsset})
                </span>
                <Input
                  type="number"
                  min="0"
                  max={positionState.availableQuantity}
                  step="any"
                  value={partialCloseInput}
                  onChange={event => setPartialCloseInput(event.target.value)}
                  placeholder={defaultTradeQuantity}
                  className="border-white/8 bg-white/3 text-white"
                />
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setIsModifyDialogOpen(false)}>
                  Keep open
                </Button>
                <Button
                  type="button"
                  variant="default"
                  className="flex-1 bg-rose-400/15 text-rose-100 hover:bg-rose-400/20"
                  disabled={isSubmitting}
                  onClick={() => {
                    void handleSubmitPartialClose();
                  }}
                >
                  {isSubmitting ? 'Closing...' : positionState.quantity >= 0 ? 'Sell to close' : 'Buy to close'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
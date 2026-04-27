'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

import { type TradingPanelProps } from '@/components/market-terminal/trading-panel.types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CircleX } from 'lucide-react';
import { formatPrice } from '@/lib/market-terminal';
import { DbConnection, reducers, tables } from '@/src/module_bindings';
import type { MarketPositionState, OpenPositionLotState, MarketSnapshot } from '@/src/module_bindings/types';

const ORDER_SIDE_BUY = 'buy';
const ORDER_EXECUTION_TYPE_OPEN = 'open';
const ORDER_STATUS_OPEN = 'open';

type TradingAccountState = {
  currency: string;
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
  const [selectedPosition, setSelectedPosition] = useState<MarketPositionState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [closingLotId, setClosingLotId] = useState<bigint | null>(null);
  const [isCancellingOrderId, setIsCancellingOrderId] = useState<string | null>(null);
  const [hasTradingAccess, setHasTradingAccess] = useState(false);
  const [hasTradingAccessResolved, setHasTradingAccessResolved] = useState(false);
  const [markets] = useTable(tables.market);
  const [snapshots] = useTable(tables.marketSnapshot);
  const [accountRows, accountReady] = useTable(tables.myTradingAccountState);
  const [positionRows, positionReady] = useTable(tables.myMarketPositionState);
  const [ordersRows, ordersReady] = useTable(tables.myMarketOrders);
  const [openPositionLotRows, openPositionLotsReady] = useTable(tables.myOpenPositionLots);
  const [positionHistoryRows, positionHistoryReady] = useTable(tables.myPositionHistory);
  const accountState = (accountRows[0] as TradingAccountState | undefined) ?? null;
  const currency = accountState?.currency ?? quoteAsset;
  const defaultTradeQuantity = useMemo(() => getDefaultTradeQuantity(baseAsset), [baseAsset]);
  const marketById = useMemo(() => new Map(markets.map(market => [market.id, market])), [markets]);
  const snapshotByMarketId = useMemo(
    () => new Map((snapshots as readonly MarketSnapshot[]).map(snapshot => [snapshot.marketId, snapshot])),
    [snapshots]
  );
  const getMarketMeta = useMemo(
    () =>
      (targetMarketId: number) => {
        const market = marketById.get(targetMarketId);

        if (market) {
          return {
            symbol: market.symbol,
            baseAsset: market.baseAsset,
            precision: market.precision,
            price: snapshotByMarketId.get(targetMarketId)?.price,
          };
        }

        if (targetMarketId === marketId) {
          return {
            symbol: marketSymbol,
            baseAsset,
            precision,
            price: snapshotByMarketId.get(targetMarketId)?.price,
          };
        }

        return {
          symbol: `Market #${targetMarketId}`,
          baseAsset: 'Units',
          precision,
          price: snapshotByMarketId.get(targetMarketId)?.price,
        };
      },
    [baseAsset, marketById, marketId, marketSymbol, precision, snapshotByMarketId]
  );
  const openPositionStates = useMemo(
    () =>
      positionRows
        .filter(position => position.availableQuantity > 0)
        .sort((left, right) => {
          if (left.side !== right.side) {
            return left.side === ORDER_SIDE_BUY ? -1 : 1;
          }

          return right.availableQuantity - left.availableQuantity;
        }),
    [positionRows]
  );
  const pendingOrders = useMemo(
    () => ordersRows.filter(order => order.status === ORDER_STATUS_OPEN),
    [ordersRows]
  );
  const sortedOpenPositionLotRows = useMemo(() => {
    return [...openPositionLotRows].sort((left, right) => {
      const leftOpenedAt = left.openedAt.toMillis();
      const rightOpenedAt = right.openedAt.toMillis();

      if (leftOpenedAt !== rightOpenedAt) {
        return leftOpenedAt > rightOpenedAt ? -1 : 1;
      }

      if (left.marketId !== right.marketId) {
        return left.marketId - right.marketId;
      }

      if (left.side !== right.side) {
        return left.side.localeCompare(right.side);
      }

      if (left.id === right.id) {
        return 0;
      }

      return left.id < right.id ? -1 : 1;
    });
  }, [openPositionLotRows]);
  const groupedOpenPositionOpenedAtBySide = useMemo(() => {
    const earliestBySide = new Map<string, OpenPositionLotState['openedAt']>();

    for (const lot of sortedOpenPositionLotRows) {
      const key = `${lot.marketId}:${lot.side}`;
      const earliest = earliestBySide.get(key);

      if (!earliest || lot.openedAt.toMillis() < earliest.toMillis()) {
        earliestBySide.set(key, lot.openedAt);
      }
    }

    return earliestBySide;
  }, [sortedOpenPositionLotRows]);

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

  async function handleCloseOpenPosition(position: MarketPositionState, quantity: number) {
    setErrorMessage(null);

    if (position.availableQuantity <= 0) {
      setErrorMessage('No open position is available to close.');
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setErrorMessage('Enter a valid quantity to close.');
      return;
    }

    if (quantity > position.availableQuantity) {
      setErrorMessage('Close quantity cannot exceed the open position size.');
      return;
    }

    setIsSubmitting(true);

    try {
      await closeMarketPosition({ marketId: position.marketId, side: position.side, quantity });
      setIsModifyDialogOpen(false);
      setSelectedPosition(null);
      setPartialCloseInput(defaultTradeQuantity);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to close position.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitPartialClose() {
    const quantity = Number.parseFloat(partialCloseInput);

    if (!selectedPosition) {
      setErrorMessage('Select a position to close.');
      return;
    }

    await handleCloseOpenPosition(selectedPosition, quantity);
  }

  async function handleCloseLot(lot: OpenPositionLotState) {
    setErrorMessage(null);
    setClosingLotId(lot.id);
    setIsSubmitting(true);

    try {
      await closeMarketPosition({ marketId: lot.marketId, side: lot.side, quantity: lot.quantity });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to close position.');
    } finally {
      setIsSubmitting(false);
      setClosingLotId(null);
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
      <Card className="bg-transparent border-none text-primary shadow-none">
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
      <Card className="bg-transparent border-none text-primary shadow-none">
        <CardHeader className="p-4 pb-0">
          <CardTitle className="text-sm font-medium text-white">Sign in to view positions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <p className="text-sm leading-6 text-slate-400">
            Authentication unlocks your simulated open positions, pending orders, and closed history.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!isTradingStateReady) {
    return (
      <Card className="bg-transparent border-none text-primary shadow-none">
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
      <Card className="bg-transparent border-none text-primary shadow-none">
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
              {openPositionStates.length > 0
                ? `${openPositionStates.length} open position${openPositionStates.length === 1 ? '' : 's'}`
                : 'No open position'}
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
              {openPositionStates.length > 0 ? (
                <div className="space-y-3 rounded-2xl border border-white/8 bg-white/3 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      {showGroupedPositions
                        ? `Grouped into ${openPositionStates.length} side-specific position${openPositionStates.length === 1 ? '' : 's'}`
                        : `Showing ${sortedOpenPositionLotRows.length} individual trade${sortedOpenPositionLotRows.length === 1 ? '' : 's'}`}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowGroupedPositions(current => !current)}>
                        {showGroupedPositions ? 'Show individual positions' : 'Group positions'}
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
                        <TableHead className="w-8"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {showGroupedPositions ? (
                        openPositionStates.map(positionState => (
                          <TableRow key={`${positionState.marketId}:${positionState.side}`}>
                            <TableCell>{getMarketMeta(positionState.marketId).symbol}</TableCell>
                            <TableCell className={positionState.side === ORDER_SIDE_BUY ? 'text-emerald-300' : 'text-rose-300'}>
                              {positionState.side}
                            </TableCell>
                            <TableCell className="text-right">{positionState.availableQuantity.toFixed(4)}</TableCell>
                            <TableCell className="text-right">{formatPrice(positionState.averageEntryPrice, getMarketMeta(positionState.marketId).precision)}</TableCell>
                            <TableCell className="text-right">{formatPrice(positionState.markPrice, getMarketMeta(positionState.marketId).precision)}</TableCell>
                            <TableCell>{formatTimestamp(groupedOpenPositionOpenedAtBySide.get(`${positionState.marketId}:${positionState.side}`))}</TableCell>
                            <TableCell className={`text-right ${positionState.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {formatSignedCurrencyAmount(positionState.unrealizedPnl, currency)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  className="bg-rose-400/15 text-rose-100 hover:bg-rose-400/20"
                                  disabled={isSubmitting}
                                  onClick={() => {
                                    void handleCloseOpenPosition(positionState, positionState.availableQuantity);
                                  }}
                                >
                                  {isSubmitting && selectedPosition?.side === positionState.side ? 'Closing...' : 'Close'}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const positionMarket = getMarketMeta(positionState.marketId);
                                    setSelectedPosition(positionState);
                                    setPartialCloseInput(
                                      Math.min(
                                        Number.parseFloat(getDefaultTradeQuantity(positionMarket.baseAsset)),
                                        positionState.availableQuantity
                                      ).toString()
                                    );
                                    setIsModifyDialogOpen(true);
                                  }}
                                >
                                  Modify
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        sortedOpenPositionLotRows.map(positionLot => (
                          <TableRow key={positionLot.id.toString()} className="group">
                            <TableCell>{getMarketMeta(positionLot.marketId).symbol}</TableCell>
                            <TableCell className={positionLot.side === ORDER_SIDE_BUY ? 'text-emerald-300' : 'text-rose-300'}>
                              {positionLot.side}
                            </TableCell>
                            <TableCell className="text-right">{positionLot.quantity.toFixed(4)}</TableCell>
                            <TableCell className="text-right">{formatPrice(positionLot.openPrice, getMarketMeta(positionLot.marketId).precision)}</TableCell>
                            <TableCell className="text-right">{formatPrice(positionLot.currentPrice, getMarketMeta(positionLot.marketId).precision)}</TableCell>
                            <TableCell>{formatTimestamp(positionLot.openedAt)}</TableCell>
                            <TableCell className={`text-right ${positionLot.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {formatSignedCurrencyAmount(positionLot.unrealizedPnl, currency)}
                            </TableCell>
                            <TableCell className="w-8">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 p-0 text-rose-300 hover:bg-rose-400/15 hover:text-rose-100"
                                    disabled={isSubmitting}
                                    onClick={() => { void handleCloseLot(positionLot); }}
                                  >
                                    {closingLotId === positionLot.id ? <Spinner /> : <CircleX />}
                                    <span className="sr-only">Close position</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="right" sideOffset={8}>Close position</TooltipContent>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-slate-500">
                  No open positions.
                </div>
              )}
            </TabsContent>

            <TabsContent value="pending" className="space-y-2">
              {pendingOrders.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-slate-500">
                  No pending orders.
                </div>
              ) : (
                pendingOrders.slice(0, 6).map(order => {
                  const sideClass = order.side === ORDER_SIDE_BUY ? 'text-emerald-300' : 'text-rose-300';
                  const marketMeta = getMarketMeta(order.marketId);

                  return (
                    <div key={order.id.toString()} className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className={`text-sm font-medium ${sideClass}`}>
                            {marketMeta.symbol} | {order.executionType === ORDER_EXECUTION_TYPE_OPEN ? 'Open' : 'Close'} {order.side === ORDER_SIDE_BUY ? 'Buy' : 'Sell'} {order.quantity.toFixed(4)} {marketMeta.baseAsset}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {order.orderType} @ {formatPrice(order.limitPrice ?? marketMeta.price ?? 0, marketMeta.precision)}
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
              {positionHistoryRows.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm text-slate-500">
                  No closed history yet.
                </div>
              ) : (
                positionHistoryRows.slice(0, 6).map(positionHistory => {
                  const realizedPnlClass = positionHistory.realizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300';
                  const marketMeta = getMarketMeta(positionHistory.marketId);

                  return (
                    <div key={positionHistory.id.toString()} className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-white">
                            {marketMeta.symbol} | Closed {positionHistory.quantity.toFixed(4)} {marketMeta.baseAsset}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Entry {formatPrice(positionHistory.entryPrice, marketMeta.precision)} | Exit {formatPrice(positionHistory.exitPrice, marketMeta.precision)}
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

      <Dialog
        open={isModifyDialogOpen && !!selectedPosition}
        onOpenChange={open => {
          setIsModifyDialogOpen(open);

          if (!open) {
            setSelectedPosition(null);
          }
        }}
      >
        {selectedPosition ? (
          <DialogContent
            showCloseButton={false}
            className="max-w-md p-0 text-slate-300 shadow-[0_30px_100px_rgba(0,0,0,0.42)]"
          >
            {(() => {
              const selectedMarket = getMarketMeta(selectedPosition.marketId);

              return (
                <>
                  <DialogHeader className="p-4 pb-0">
                    <DialogTitle className="text-sm font-medium text-white">
                      Partial close {selectedPosition.side} {selectedMarket.symbol}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                      Choose how much of the open {selectedPosition.side} position to close.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 p-4">
                    <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-xs text-slate-400">
                      Open size {selectedPosition.availableQuantity.toFixed(4)} {selectedMarket.baseAsset} | Mark {formatPrice(selectedPosition.markPrice, selectedMarket.precision)}
                    </div>

                    <div className="space-y-2">
                      <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Close quantity ({selectedMarket.baseAsset})
                      </span>
                      <Input
                        type="number"
                        min="0"
                        max={selectedPosition.availableQuantity}
                        step="any"
                        value={partialCloseInput}
                        onChange={event => setPartialCloseInput(event.target.value)}
                        placeholder={getDefaultTradeQuantity(selectedMarket.baseAsset)}
                        className="border-white/8 bg-white/3 text-white"
                      />
                    </div>

                    <DialogFooter className="flex-row gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setIsModifyDialogOpen(false);
                          setSelectedPosition(null);
                        }}
                      >
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
                        {isSubmitting
                          ? 'Closing...'
                          : selectedPosition.side === ORDER_SIDE_BUY
                            ? 'Sell to close'
                            : 'Buy to close'}
                      </Button>
                    </DialogFooter>
                  </div>
                </>
              );
            })()}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
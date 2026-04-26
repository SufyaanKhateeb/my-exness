'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

import { type TradingPanelProps } from '@/components/market-terminal/trading-panel.types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { formatPrice } from '@/lib/market-terminal';
import { DbConnection, reducers, tables } from '@/src/module_bindings';

const ORDER_SIDE_BUY = 'buy';
const ORDER_SIDE_SELL = 'sell';
const ORDER_EXECUTION_TYPE_OPEN = 'open';
const ORDER_TYPE_MARKET = 'market';
const ORDER_TYPE_LIMIT = 'limit';

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

export function LiveOrderWidget({
  marketId,
  marketSymbol,
  baseAsset,
  quoteAsset,
  precision,
}: TradingPanelProps) {
  const { user, isLoading } = useUser();
  const { getConnection, isActive } = useSpacetimeDB();
  const placeMarketOrder = useReducer(reducers.placeMarketOrder);
  const placeLimitOrder = useReducer(reducers.placeLimitOrder);
  const [side, setSide] = useState<typeof ORDER_SIDE_BUY | typeof ORDER_SIDE_SELL>(ORDER_SIDE_BUY);
  const [orderType, setOrderType] = useState<typeof ORDER_TYPE_MARKET | typeof ORDER_TYPE_LIMIT>(ORDER_TYPE_MARKET);
  const [quantityInput, setQuantityInput] = useState(() => getDefaultTradeQuantity(baseAsset));
  const [limitPriceInput, setLimitPriceInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasTradingAccess, setHasTradingAccess] = useState(false);
  const [hasTradingAccessResolved, setHasTradingAccessResolved] = useState(false);
  const [snapshots] = useTable(tables.marketSnapshot.where(snapshot => snapshot.marketId.eq(marketId)));

  const snapshot = (snapshots[0] as MarketSnapshotState | undefined) ?? null;
  const defaultTradeQuantity = useMemo(() => getDefaultTradeQuantity(baseAsset), [baseAsset]);

  useEffect(() => {
    setQuantityInput(defaultTradeQuantity);
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
    : hasTradingAccessResolved;

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
          executionType: ORDER_EXECUTION_TYPE_OPEN,
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
          executionType: ORDER_EXECUTION_TYPE_OPEN,
          quantity,
          limitPrice,
        });
      }

      setQuantityInput(defaultTradeQuantity);
      if (orderType === ORDER_TYPE_LIMIT) {
        setLimitPriceInput('');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Order placement failed.');
    } finally {
      setIsSubmitting(false);
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
          <CardTitle className="text-sm font-medium text-white">Sign in to place orders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <p className="text-sm leading-6 text-slate-400">
            Authentication unlocks the order entry widget for this market.
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

  if (!hasTradingAccess) {
    return (
      <Card className="bg-transparent border-none text-primary shadow-none">
        <CardHeader className="p-4 pb-0">
          <CardTitle className="text-sm font-medium text-white">Trading access unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm leading-6 text-slate-400">
            Your Auth0 session is valid, but no trade-enabled account state is available in SpacetimeDB yet.
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
    <Card className="bg-transparent border-none text-primary shadow-none">
      <CardHeader className="p-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-medium text-white">{marketSymbol} order widget</CardTitle>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
            Last {snapshot ? formatPrice(snapshot.price, precision) : '--'}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {errorMessage ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <div className="space-y-3 rounded-2xl border border-white/8 bg-white/3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={orderType === ORDER_TYPE_MARKET ? 'default' : 'outline'} size="sm" onClick={() => setOrderType(ORDER_TYPE_MARKET)}>
              Market
            </Button>
            <Button type="button" variant={orderType === ORDER_TYPE_LIMIT ? 'default' : 'outline'} size="sm" onClick={() => setOrderType(ORDER_TYPE_LIMIT)}>
              Limit
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={side === ORDER_SIDE_BUY ? 'default' : 'outline'} size="sm" className={side === ORDER_SIDE_BUY ? 'bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/20' : undefined} onClick={() => setSide(ORDER_SIDE_BUY)}>
              Buy
            </Button>
            <Button type="button" variant={side === ORDER_SIDE_SELL ? 'default' : 'outline'} size="sm" className={side === ORDER_SIDE_SELL ? 'bg-rose-400/15 text-rose-100 hover:bg-rose-400/20' : undefined} onClick={() => setSide(ORDER_SIDE_SELL)}>
              Sell
            </Button>
          </div>

          <div className="space-y-2">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-500">Quantity ({baseAsset})</span>
            <Input type="number" min="0" step="any" value={quantityInput} onChange={event => setQuantityInput(event.target.value)} placeholder={`0.00 ${baseAsset}`} className="border-white/8 bg-white/3 text-white" />
          </div>

          {orderType === ORDER_TYPE_LIMIT ? (
            <div className="space-y-2">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-500">Limit price ({quoteAsset})</span>
              <Input type="number" min="0" step="any" value={limitPriceInput} onChange={event => setLimitPriceInput(event.target.value)} placeholder={snapshot ? formatPrice(snapshot.price, precision) : '0.00'} className="border-white/8 bg-white/3 text-white" />
            </div>
          ) : null}

          <Button type="button" className={side === ORDER_SIDE_BUY ? 'bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/20' : 'bg-rose-400/15 text-rose-100 hover:bg-rose-400/20'} disabled={isSubmitting} onClick={() => { void handleSubmitOrder(); }}>
            {isSubmitting ? 'Submitting...' : `${side === ORDER_SIDE_BUY ? 'Buy' : 'Sell'} ${orderType}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
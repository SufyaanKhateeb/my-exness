'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatPercent, formatPrice } from '@/lib/market-terminal';
import { cn } from '@/lib/utils';

export type MarketSidebarItem = {
  id: number;
  symbol: string;
  assetClass: string;
  precision: number;
  bid: number;
  spread: number;
  ask: number;
  change24H: number;
  unrealizedPnl: number;
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
  const [query, setQuery] = useState('');

  const filteredMarkets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return markets;
    }

    return markets.filter(market => {
      const haystack = `${market.symbol} ${market.assetClass}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [markets, query]);

  return (
    <Card className="rounded-3xl border-border/70 shadow-sm">
      <CardHeader className="gap-4 p-4 pb-0 xl:p-5 xl:pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardDescription className="text-[11px] uppercase tracking-[0.28em]">Instruments</CardDescription>
            <CardTitle className="text-xl">Market watch</CardTitle>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onResetSimulation}>
            Reset tape
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search instruments"
            className="pl-9"
          />
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-4 xl:p-5 xl:pt-4">
        <div className="overflow-hidden rounded-2xl border border-border/70">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-3">Symbol</TableHead>
                <TableHead className="w-14 px-2 text-center">Signal</TableHead>
                <TableHead className="px-3 text-right">Bid</TableHead>
                <TableHead className="px-3 text-right">Spread</TableHead>
                <TableHead className="px-3 text-right">Ask</TableHead>
                <TableHead className="px-3 text-right">1 Day</TableHead>
                <TableHead className="px-3 text-right">P/L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMarkets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No instruments match your search.
                  </TableCell>
                </TableRow>
              ) : (
                filteredMarkets.map(market => {
                  const active = market.id === selectedMarketId;
                  const positive = market.change24H >= 0;
                  const profitable = market.unrealizedPnl >= 0;

                  return (
                    <TableRow
                      key={market.id}
                      data-state={active ? 'selected' : undefined}
                      onClick={() => onSelectMarket(market.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="px-3 py-3">
                        <div className="text-sm font-semibold text-foreground">{market.symbol}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                          {market.assetClass}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-3 text-center">
                        <span
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold',
                            positive
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'border-destructive/30 bg-destructive/10 text-destructive'
                          )}
                        >
                          {positive ? '↑' : '↓'}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-sm font-medium text-foreground">
                        {formatPrice(market.bid, market.precision)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-sm text-muted-foreground">
                        {formatPrice(market.spread, market.precision)}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-sm font-medium text-foreground">
                        {formatPrice(market.ask, market.precision)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'px-3 py-3 text-right text-sm font-medium',
                          positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                        )}
                      >
                        {formatPercent(market.change24H)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'px-3 py-3 text-right text-sm font-medium',
                          profitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                        )}
                      >
                        {market.unrealizedPnl === 0 ? '—' : formatPrice(market.unrealizedPnl, 2)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
import { SenderError } from 'spacetimedb/server';

import type { ExchangeCtx } from './module';
import { isExternalMarketDataMode } from './simulator-config';
import { timestampFromMillis } from './simulator-market';
import { evaluatePriceAlertsForMarket, maybeFillOpenLimitOrders } from './trading-runtime';

type ExternalMarketInput = {
  marketId: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  assetClass: string;
  precision: number;
  spreadBps: number;
  changeRate: number;
  quoteIntervalMs: number;
};

type ExternalMarketSnapshotInput = {
  marketId: number;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  change24h: number;
  volume24h: number;
  updatedAtMillis: number;
};

type ExternalMarketCandleInput = {
  marketId: number;
  bucketStartMillis: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ExternalMarketOrderBookLevelInput = {
  level: number;
  price: number;
  size: number;
};

function requireExternalMarketDataMode() {
  if (!isExternalMarketDataMode()) {
    throw new SenderError('External market ingestion is only available when SPACETIMEDB_MARKET_DATA_MODE=external.');
  }
}

function requireExistingMarket(ctx: ExchangeCtx, marketId: number) {
  const market = ctx.db.market.id.find(marketId);

  if (!market) {
    throw new SenderError(`Market ${marketId} is not registered.`);
  }

  return market;
}

function requireFinitePrice(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SenderError(`${label} must be greater than zero.`);
  }
}

function requireFiniteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new SenderError(`${label} must be a finite number.`);
  }
}

function requireNonNegativeNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new SenderError(`${label} must be zero or greater.`);
  }
}

function getExternalCandleId(marketId: number, bucketStartMillis: number) {
  return BigInt(bucketStartMillis) * BigInt(10_000) + BigInt(marketId);
}

function getExternalOrderBookLevelId(marketId: number, isBid: boolean, level: number) {
  return BigInt(marketId) * BigInt(1_000) + BigInt(level * 2 + (isBid ? 1 : 0));
}

function getDayBucketStartMillis(bucketStartMillis: number) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor(bucketStartMillis / dayMs) * dayMs;
}

function triggerMarketDataSideEffects(
  ctx: ExchangeCtx,
  marketId: number,
  updatedAtMillis: number
) {
  const updatedAt = timestampFromMillis(updatedAtMillis);
  evaluatePriceAlertsForMarket(ctx, marketId, updatedAt);
  maybeFillOpenLimitOrders(ctx, marketId, 0, updatedAt);
}

function upsertExternalMarket(ctx: ExchangeCtx, input: ExternalMarketInput) {
  requireExternalMarketDataMode();
  requireFinitePrice(input.quoteIntervalMs, 'quoteIntervalMs');
  requireNonNegativeNumber(input.spreadBps, 'spreadBps');
  requireNonNegativeNumber(input.changeRate, 'changeRate');

  const nextMarket = {
    id: input.marketId,
    symbol: input.symbol.trim(),
    baseAsset: input.baseAsset.trim(),
    quoteAsset: input.quoteAsset.trim(),
    assetClass: input.assetClass.trim(),
    spreadBps: input.spreadBps,
    changeRate: input.changeRate,
    quoteIntervalMs: Math.floor(input.quoteIntervalMs),
    precision: input.precision,
  };

  if (!nextMarket.symbol || !nextMarket.baseAsset || !nextMarket.quoteAsset || !nextMarket.assetClass) {
    throw new SenderError('Market metadata fields must not be empty.');
  }

  if (!Number.isInteger(nextMarket.precision) || nextMarket.precision < 0 || nextMarket.precision > 255) {
    throw new SenderError('precision must be an integer between 0 and 255.');
  }

  const existingMarket = ctx.db.market.id.find(input.marketId);

  if (existingMarket) {
    existingMarket.symbol = nextMarket.symbol;
    existingMarket.baseAsset = nextMarket.baseAsset;
    existingMarket.quoteAsset = nextMarket.quoteAsset;
    existingMarket.assetClass = nextMarket.assetClass;
    existingMarket.spreadBps = nextMarket.spreadBps;
    existingMarket.changeRate = nextMarket.changeRate;
    existingMarket.quoteIntervalMs = nextMarket.quoteIntervalMs;
    existingMarket.precision = nextMarket.precision;
    ctx.db.market.id.update(existingMarket);
    return;
  }

  ctx.db.market.insert(nextMarket);
}

function upsertExternalMarketSnapshot(ctx: ExchangeCtx, input: ExternalMarketSnapshotInput) {
  requireExternalMarketDataMode();
  requireExistingMarket(ctx, input.marketId);
  requireFinitePrice(input.price, 'price');
  requireFinitePrice(input.open24h, 'open24h');
  requireFinitePrice(input.high24h, 'high24h');
  requireFinitePrice(input.low24h, 'low24h');
  requireFiniteNumber(input.change24h, 'change24h');
  requireNonNegativeNumber(input.volume24h, 'volume24h');

  const nextSnapshot = {
    marketId: input.marketId,
    price: input.price,
    open24h: input.open24h,
    high24h: input.high24h,
    low24h: input.low24h,
    change24h: input.change24h,
    volume24h: input.volume24h,
    updatedAt: timestampFromMillis(input.updatedAtMillis),
  };
  const existingSnapshot = ctx.db.marketSnapshot.marketId.find(input.marketId);

  if (existingSnapshot) {
    existingSnapshot.price = nextSnapshot.price;
    existingSnapshot.open24h = nextSnapshot.open24h;
    existingSnapshot.high24h = nextSnapshot.high24h;
    existingSnapshot.low24h = nextSnapshot.low24h;
    existingSnapshot.change24h = nextSnapshot.change24h;
    existingSnapshot.volume24h = nextSnapshot.volume24h;
    existingSnapshot.updatedAt = nextSnapshot.updatedAt;
    ctx.db.marketSnapshot.marketId.update(existingSnapshot);
  } else {
    ctx.db.marketSnapshot.insert(nextSnapshot);
  }

  triggerMarketDataSideEffects(ctx, input.marketId, input.updatedAtMillis);
}

function validateExternalCandle(input: ExternalMarketCandleInput) {
  requireFinitePrice(input.open, 'open');
  requireFinitePrice(input.high, 'high');
  requireFinitePrice(input.low, 'low');
  requireFinitePrice(input.close, 'close');
  requireNonNegativeNumber(input.volume, 'volume');

  if (input.high + Number.EPSILON < Math.max(input.open, input.close)) {
    throw new SenderError('high must be greater than or equal to open and close.');
  }

  if (input.low - Number.EPSILON > Math.min(input.open, input.close)) {
    throw new SenderError('low must be less than or equal to open and close.');
  }
}

function upsertExternalMinuteCandle(ctx: ExchangeCtx, input: ExternalMarketCandleInput) {
  requireExternalMarketDataMode();
  requireExistingMarket(ctx, input.marketId);
  validateExternalCandle(input);

  const nextRow = {
    id: getExternalCandleId(input.marketId, input.bucketStartMillis),
    marketId: input.marketId,
    bucketStart: timestampFromMillis(input.bucketStartMillis),
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volume: input.volume,
  };
  const existingRow = ctx.db.marketMinuteCandle.id.find(nextRow.id);

  if (existingRow) {
    existingRow.open = nextRow.open;
    existingRow.high = nextRow.high;
    existingRow.low = nextRow.low;
    existingRow.close = nextRow.close;
    existingRow.volume = nextRow.volume;
    ctx.db.marketMinuteCandle.id.update(existingRow);
    return;
  }

  ctx.db.marketMinuteCandle.insert(nextRow);
}

function upsertExternalMinuteCandles(
  ctx: ExchangeCtx,
  inputs: readonly ExternalMarketCandleInput[]
) {
  for (const input of inputs) {
    upsertExternalMinuteCandle(ctx, input);
  }
}

function upsertExternalDayCandle(ctx: ExchangeCtx, input: ExternalMarketCandleInput) {
  requireExternalMarketDataMode();
  requireExistingMarket(ctx, input.marketId);
  validateExternalCandle(input);

  const nextRow = {
    id: getExternalCandleId(input.marketId, input.bucketStartMillis),
    marketId: input.marketId,
    bucketStart: timestampFromMillis(input.bucketStartMillis),
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volume: input.volume,
  };
  const existingRow = ctx.db.marketDayCandle.id.find(nextRow.id);

  if (existingRow) {
    existingRow.open = nextRow.open;
    existingRow.high = nextRow.high;
    existingRow.low = nextRow.low;
    existingRow.close = nextRow.close;
    existingRow.volume = nextRow.volume;
    ctx.db.marketDayCandle.id.update(existingRow);
    return;
  }

  ctx.db.marketDayCandle.insert(nextRow);
}

function upsertExternalDayCandles(
  ctx: ExchangeCtx,
  inputs: readonly ExternalMarketCandleInput[]
) {
  for (const input of inputs) {
    upsertExternalDayCandle(ctx, input);
  }
}

function deleteExternalCandlesInRange(
  ctx: ExchangeCtx,
  marketId: number,
  startMillisInclusive: number,
  endMillisExclusive: number
) {
  requireExternalMarketDataMode();
  requireExistingMarket(ctx, marketId);

  if (!Number.isFinite(startMillisInclusive) || !Number.isFinite(endMillisExclusive)) {
    throw new SenderError('Candle deletion range must use finite timestamps.');
  }

  if (endMillisExclusive <= startMillisInclusive) {
    throw new SenderError('Candle deletion range end must be greater than start.');
  }

  for (const row of Array.from(ctx.db.marketMinuteCandle.marketId.filter(marketId))) {
    const bucketStartMillis = Number(row.bucketStart.toMillis());

    if (bucketStartMillis >= startMillisInclusive && bucketStartMillis < endMillisExclusive) {
      ctx.db.marketMinuteCandle.delete(row);
    }
  }

  const dayStartMillisInclusive = getDayBucketStartMillis(startMillisInclusive);
  const dayStartMillisExclusive = getDayBucketStartMillis(endMillisExclusive - 1) + 24 * 60 * 60 * 1000;

  for (const row of Array.from(ctx.db.marketDayCandle.marketId.filter(marketId))) {
    const bucketStartMillis = Number(row.bucketStart.toMillis());

    if (bucketStartMillis >= dayStartMillisInclusive && bucketStartMillis < dayStartMillisExclusive) {
      ctx.db.marketDayCandle.delete(row);
    }
  }
}

function replaceExternalMarketOrderBook(
  ctx: ExchangeCtx,
  marketId: number,
  updatedAtMillis: number,
  bids: readonly ExternalMarketOrderBookLevelInput[],
  asks: readonly ExternalMarketOrderBookLevelInput[]
) {
  requireExternalMarketDataMode();
  requireExistingMarket(ctx, marketId);

  for (const [, levels] of [[true, bids], [false, asks]] as const) {
    for (const level of levels) {
      requireFinitePrice(level.price, 'order book price');
      requireNonNegativeNumber(level.size, 'order book size');

      if (!Number.isInteger(level.level) || level.level < 0 || level.level > 255) {
        throw new SenderError('order book level must be an integer between 0 and 255.');
      }
    }
  }

  for (const level of Array.from(ctx.db.marketOrderBookLevel.marketId.filter(marketId))) {
    ctx.db.marketOrderBookLevel.delete(level);
  }

  const updatedAt = timestampFromMillis(updatedAtMillis);

  for (const [isBid, levels] of [[true, bids], [false, asks]] as const) {
    for (const level of levels) {

      ctx.db.marketOrderBookLevel.insert({
        id: getExternalOrderBookLevelId(marketId, isBid, level.level),
        marketId,
        isBid,
        level: level.level,
        price: level.price,
        size: level.size,
        updatedAt,
      });
    }
  }

  triggerMarketDataSideEffects(ctx, marketId, updatedAtMillis);
}

export {
  deleteExternalCandlesInRange,
  replaceExternalMarketOrderBook,
  requireExternalMarketDataMode,
  upsertExternalDayCandle,
  upsertExternalDayCandles,
  upsertExternalMarket,
  upsertExternalMarketSnapshot,
  upsertExternalMinuteCandle,
  upsertExternalMinuteCandles,
};

export type {
  ExternalMarketCandleInput,
  ExternalMarketInput,
  ExternalMarketOrderBookLevelInput,
  ExternalMarketSnapshotInput,
};
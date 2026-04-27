import { t } from 'spacetimedb/server';

import spacetimedb from './module';
import { MARKET_INGEST_PERMISSION } from './simulator-config';
import { ensurePermission } from './simulator-auth';
import {
  deleteExternalCandlesInRange as deleteExternalCandlesInRangeRows,
  replaceExternalMarketOrderBook,
  upsertExternalDayCandle as upsertExternalDayCandleRow,
  upsertExternalDayCandles as upsertExternalDayCandleRows,
  upsertExternalMarket,
  upsertExternalMarketSnapshot,
  upsertExternalMinuteCandle as upsertExternalMinuteCandleRow,
  upsertExternalMinuteCandles as upsertExternalMinuteCandleRows,
} from './market-ingest-runtime';

const externalOrderBookLevelInputRow = t.row('ExternalOrderBookLevelInput', {
  level: t.u8(),
  price: t.f64(),
  size: t.f64(),
});

const externalMarketCandleInputRow = t.row('ExternalMarketCandleInput', {
  marketId: t.u32(),
  bucketStartMillis: t.u64(),
  open: t.f64(),
  high: t.f64(),
  low: t.f64(),
  close: t.f64(),
  volume: t.f64(),
});

const bootstrapExternalMarket = spacetimedb.reducer(
  {
    marketId: t.u32(),
    symbol: t.string(),
    baseAsset: t.string(),
    quoteAsset: t.string(),
    assetClass: t.string(),
    precision: t.u8(),
    spreadBps: t.f64(),
    changeRate: t.f64(),
    quoteIntervalMs: t.u32(),
  },
  (ctx, input) => {
    ensurePermission(ctx, MARKET_INGEST_PERMISSION);
    upsertExternalMarket(ctx, input);
  }
);

const ingestExternalMarketSnapshot = spacetimedb.reducer(
  {
    marketId: t.u32(),
    price: t.f64(),
    open24h: t.f64(),
    high24h: t.f64(),
    low24h: t.f64(),
    change24h: t.f64(),
    volume24h: t.f64(),
    updatedAtMillis: t.u64(),
  },
  (ctx, input) => {
    ensurePermission(ctx, MARKET_INGEST_PERMISSION);
    upsertExternalMarketSnapshot(ctx, {
      ...input,
      updatedAtMillis: Number(input.updatedAtMillis),
    });
  }
);

const replaceExternalOrderBook = spacetimedb.reducer(
  {
    marketId: t.u32(),
    updatedAtMillis: t.u64(),
    bids: t.array(externalOrderBookLevelInputRow),
    asks: t.array(externalOrderBookLevelInputRow),
  },
  (ctx, input) => {
    ensurePermission(ctx, MARKET_INGEST_PERMISSION);
    replaceExternalMarketOrderBook(
      ctx,
      input.marketId,
      Number(input.updatedAtMillis),
      input.bids,
      input.asks
    );
  }
);

const upsertExternalMinuteCandle = spacetimedb.reducer(
  {
    marketId: t.u32(),
    bucketStartMillis: t.u64(),
    open: t.f64(),
    high: t.f64(),
    low: t.f64(),
    close: t.f64(),
    volume: t.f64(),
  },
  (ctx, input) => {
    ensurePermission(ctx, MARKET_INGEST_PERMISSION);
    upsertExternalMinuteCandleRow(ctx, {
      ...input,
      bucketStartMillis: Number(input.bucketStartMillis),
    });
  }
);

const upsertExternalDayCandle = spacetimedb.reducer(
  {
    marketId: t.u32(),
    bucketStartMillis: t.u64(),
    open: t.f64(),
    high: t.f64(),
    low: t.f64(),
    close: t.f64(),
    volume: t.f64(),
  },
  (ctx, input) => {
    ensurePermission(ctx, MARKET_INGEST_PERMISSION);
    upsertExternalDayCandleRow(ctx, {
      ...input,
      bucketStartMillis: Number(input.bucketStartMillis),
    });
  }
);

const upsertExternalMinuteCandles = spacetimedb.reducer(
  {
    candles: t.array(externalMarketCandleInputRow),
  },
  (ctx, input) => {
    ensurePermission(ctx, MARKET_INGEST_PERMISSION);
    upsertExternalMinuteCandleRows(
      ctx,
      input.candles.map(candle => ({
        ...candle,
        bucketStartMillis: Number(candle.bucketStartMillis),
      }))
    );
  }
);

const upsertExternalDayCandles = spacetimedb.reducer(
  {
    candles: t.array(externalMarketCandleInputRow),
  },
  (ctx, input) => {
    ensurePermission(ctx, MARKET_INGEST_PERMISSION);
    upsertExternalDayCandleRows(
      ctx,
      input.candles.map(candle => ({
        ...candle,
        bucketStartMillis: Number(candle.bucketStartMillis),
      }))
    );
  }
);

const deleteExternalCandlesInRange = spacetimedb.reducer(
  {
    marketId: t.u32(),
    startMillisInclusive: t.u64(),
    endMillisExclusive: t.u64(),
  },
  (ctx, input) => {
    ensurePermission(ctx, MARKET_INGEST_PERMISSION);
    deleteExternalCandlesInRangeRows(
      ctx,
      input.marketId,
      Number(input.startMillisInclusive),
      Number(input.endMillisExclusive),
    );
  }
);

export {
  bootstrapExternalMarket,
  deleteExternalCandlesInRange,
  ingestExternalMarketSnapshot,
  replaceExternalOrderBook,
  upsertExternalDayCandle,
  upsertExternalDayCandles,
  upsertExternalMinuteCandle,
  upsertExternalMinuteCandles,
};
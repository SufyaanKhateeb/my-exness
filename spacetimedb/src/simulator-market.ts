import { Timestamp } from 'spacetimedb';

import {
  DAY_HISTORY_COUNT,
  MS_PER_DAY,
  MS_PER_MINUTE,
  ORDER_BOOK_LEVELS_PER_SIDE,
  RNG_MASK,
} from './simulator-config';
import type {
  CandleRow,
  MarketOrderBookLevelRow,
  MarketSnapshotRow,
  SeedMarket,
} from './simulator-config';
import type { ExchangeCtx } from './module';

function timestampFromMillis(value: number) {
  return Timestamp.fromDate(new Date(value));
}

function clampPrice(value: number, minPrice: number) {
  return Math.max(minPrice, value);
}

function nextSeed(seed: bigint) {
  let value = (seed ^ BigInt('0x9e3779b97f4a7c15')) & RNG_MASK;
  value ^= value << BigInt(13);
  value &= RNG_MASK;
  value ^= value >> BigInt(7);
  value &= RNG_MASK;
  value ^= value << BigInt(17);
  return value & RNG_MASK;
}

function unitFloat(seed: bigint) {
  return Number(seed % BigInt(1_000_000)) / 1_000_000;
}

function floorToMinute(timestamp: Timestamp) {
  const millis = Number(timestamp.toMillis());
  return timestampFromMillis(Math.floor(millis / MS_PER_MINUTE) * MS_PER_MINUTE);
}

function floorToDay(timestamp: Timestamp) {
  const millis = Number(timestamp.toMillis());
  return timestampFromMillis(Math.floor(millis / MS_PER_DAY) * MS_PER_DAY);
}

function sortCandlesByTime(left: { bucketStart: Timestamp }, right: { bucketStart: Timestamp }) {
  const delta = left.bucketStart.toMillis() - right.bucketStart.toMillis();
  if (delta < BigInt(0)) {
    return -1;
  }
  if (delta > BigInt(0)) {
    return 1;
  }
  return 0;
}

function buildQuoteTick(
  seedMarket: SeedMarket,
  currentPrice: number,
  seed: bigint,
  tick: number
) {
  const moveSeed = nextSeed(seed + BigInt(tick) + BigInt(seedMarket.id));
  const volumeSeed = nextSeed(moveSeed + BigInt(31));
  const phaseBias = tick % 320 < 220 ? 1 : -0.42;
  const shock =
    (unitFloat(moveSeed) - 0.5) * 2 * seedMarket.changeRate +
    seedMarket.drift * phaseBias;

  return {
    seed: volumeSeed,
    price: clampPrice(currentPrice * (1 + shock), seedMarket.minPrice),
    volume: seedMarket.baseVolume * (0.12 + unitFloat(volumeSeed) * 0.58),
  };
}

function buildSeedHistoryCandleBackward(
  seedMarket: SeedMarket,
  candleId: bigint,
  closePrice: number,
  seed: bigint,
  tick: number,
  bucketStart: Timestamp,
  scale: number
) {
  const moveSeed = nextSeed(seed + BigInt(tick) + BigInt(seedMarket.id * 17));
  const volumeSeed = nextSeed(moveSeed + BigInt(59));
  const scaledRate = seedMarket.changeRate * scale;
  const directionalBias = seedMarket.drift * Math.max(1, scale * 0.2);
  const shock =
    (unitFloat(moveSeed) - 0.5) * 2 * scaledRate +
    directionalBias * (tick % 28 < 18 ? 1 : -0.35);
  const boundedMultiplier = Math.max(0.1, 1 + shock);
  const open = clampPrice(closePrice / boundedMultiplier, seedMarket.minPrice);
  const wick = Math.abs(shock) * 0.78 + unitFloat(volumeSeed) * scaledRate * 0.45;

  return {
    seed: volumeSeed,
    candle: {
      id: candleId,
      marketId: seedMarket.id,
      bucketStart,
      open,
      high: Math.max(open, closePrice) * (1 + wick),
      low: clampPrice(Math.min(open, closePrice) * (1 - wick * 0.92), seedMarket.minPrice),
      close: closePrice,
      volume: seedMarket.baseVolume * scale * (0.7 + unitFloat(volumeSeed) * 1.4),
    } satisfies CandleRow,
  };
}

function buildDayCandleFromMinuteRows(
  marketId: number,
  candleId: bigint,
  minuteRows: CandleRow[],
  bucketStart: Timestamp,
  fallbackPrice: number,
  fallbackVolume: number
) {
  if (minuteRows.length === 0) {
    return {
      id: candleId,
      marketId,
      bucketStart,
      open: fallbackPrice,
      high: fallbackPrice,
      low: fallbackPrice,
      close: fallbackPrice,
      volume: fallbackVolume,
    } satisfies CandleRow;
  }

  const sortedRows = [...minuteRows].sort(sortCandlesByTime);
  const firstRow = sortedRows[0];
  const lastRow = sortedRows[sortedRows.length - 1];

  return {
    id: candleId,
    marketId,
    bucketStart,
    open: firstRow.open,
    high: sortedRows.reduce((value, row) => Math.max(value, row.high), firstRow.high),
    low: sortedRows.reduce((value, row) => Math.min(value, row.low), firstRow.low),
    close: lastRow.close,
    volume: sortedRows.reduce((value, row) => value + row.volume, 0),
  } satisfies CandleRow;
}

function buildDayCandlesFromMinuteHistory(
  marketId: number,
  minuteRows: CandleRow[],
  nextCandleId: bigint,
  fallbackPrice: number
) {
  const minuteRowsByDay = new Map<bigint, CandleRow[]>();

  for (const row of minuteRows) {
    const dayStart = floorToDay(row.bucketStart);
    const dayKey = dayStart.toMillis();
    const existingRows = minuteRowsByDay.get(dayKey);

    if (existingRows) {
      existingRows.push(row);
      continue;
    }

    minuteRowsByDay.set(dayKey, [row]);
  }

  const sortedDayKeys = [...minuteRowsByDay.keys()].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const retainedDayKeys = sortedDayKeys.slice(-DAY_HISTORY_COUNT);
  const dayRows: CandleRow[] = [];
  let currentCandleId = nextCandleId;

  for (const dayKey of retainedDayKeys) {
    const rowsForDay = minuteRowsByDay.get(dayKey) ?? [];
    const dayStart = rowsForDay[0]
      ? floorToDay(rowsForDay[0].bucketStart)
      : timestampFromMillis(Number(dayKey));

    dayRows.push(
      buildDayCandleFromMinuteRows(
        marketId,
        currentCandleId,
        rowsForDay,
        dayStart,
        fallbackPrice,
        0
      )
    );
    currentCandleId += BigInt(1);
  }

  return {
    dayRows,
    nextCandleId: currentCandleId,
  };
}

function summarizeMarketSnapshot(
  ctx: ExchangeCtx,
  seedMarket: SeedMarket,
  updatedAt: Timestamp
): MarketSnapshotRow {
  const day = floorToDay(updatedAt);
  const minuteRows = Array.from(
    ctx.db.marketDayCandle.market_day_candle_idx.filter([seedMarket.id, day])
  );

  const firstRow = minuteRows[0];
  const lastRow = minuteRows[minuteRows.length - 1];

  return {
    marketId: seedMarket.id,
    price: lastRow?.close ?? seedMarket.basePrice,
    open24h: firstRow?.open ?? seedMarket.basePrice,
    high24h: minuteRows.reduce((value, row) => Math.max(value, row.high), firstRow?.high ?? seedMarket.basePrice),
    low24h: minuteRows.reduce((value, row) => Math.min(value, row.low), firstRow?.low ?? seedMarket.basePrice),
    change24h: firstRow ? lastRow.close - firstRow.open : 0,
    volume24h: minuteRows.reduce((value, row) => value + row.volume, 0),
    updatedAt,
  };
}

function buildOrderBookLevels(
  seedMarket: SeedMarket,
  midPrice: number,
  seed: bigint,
  updatedAt: Timestamp
): MarketOrderBookLevelRow[] {
  const levels: MarketOrderBookLevelRow[] = [];
  const spread = midPrice * (seedMarket.spreadBps / 10_000);
  const topBid = clampPrice(midPrice - spread / 2, seedMarket.minPrice);
  const topAsk = topBid + spread;

  for (let level = 0; level < ORDER_BOOK_LEVELS_PER_SIDE; level += 1) {
    const levelSeed = nextSeed(seed + BigInt(level * 97 + seedMarket.id));
    const sizeBase = seedMarket.baseVolume * (0.8 + unitFloat(levelSeed) * 1.6);
    const priceStep = Math.max(spread * 0.55, midPrice * 0.0009) * level;

    levels.push({
      id: BigInt(seedMarket.id * 100 + level),
      marketId: seedMarket.id,
      isBid: true,
      level,
      price: clampPrice(topBid - priceStep, seedMarket.minPrice),
      size: sizeBase,
      updatedAt,
    });
    levels.push({
      id: BigInt(seedMarket.id * 100 + ORDER_BOOK_LEVELS_PER_SIDE + level),
      marketId: seedMarket.id,
      isBid: false,
      level,
      price: topAsk + priceStep,
      size: sizeBase,
      updatedAt,
    });
  }

  return levels;
}

export {
  buildDayCandlesFromMinuteHistory,
  buildOrderBookLevels,
  buildQuoteTick,
  buildSeedHistoryCandleBackward,
  floorToDay,
  floorToMinute,
  summarizeMarketSnapshot,
  timestampFromMillis,
};

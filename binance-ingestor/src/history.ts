import { DbConnection } from '../../src/module_bindings';
import { type IngestConfig, type IngestMarketConfig } from './config';

type BinanceKlineRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

type BinanceTickerSnapshot = {
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  priceChangePercent: string;
  volume: string;
  closeTime: number;
};

type BinanceDepthSnapshot = {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
};

export type CandleInput = {
  marketId: number;
  bucketStartMillis: bigint;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const BINANCE_KLINE_LIMIT = 1000;

export function toNumber(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function* fetchHistoricalKlineBatches(
  config: IngestConfig,
  market: IngestMarketConfig,
  startTime: number,
  endTime: number,
) {
  let nextStartTime = startTime;

  while (nextStartTime < endTime) {
    const url = new URL('/api/v3/klines', config.binanceRestBaseUrl);
    url.searchParams.set('symbol', market.binanceSymbol.toUpperCase());
    url.searchParams.set('interval', '1m');
    url.searchParams.set('limit', String(BINANCE_KLINE_LIMIT));
    url.searchParams.set('startTime', String(nextStartTime));
    url.searchParams.set('endTime', String(endTime));

    const chunk = await fetchJson<BinanceKlineRow[]>(url.toString());

    if (chunk.length === 0) {
      break;
    }

    yield chunk;
    nextStartTime = chunk[chunk.length - 1][0] + MS_PER_MINUTE;

    if (chunk.length < BINANCE_KLINE_LIMIT) {
      break;
    }
  }
}

export function buildMinuteCandleInputs(marketId: number, klines: readonly BinanceKlineRow[]) {
  return klines.map<CandleInput>(kline => ({
    marketId,
    bucketStartMillis: BigInt(kline[0]),
    open: toNumber(kline[1], 'minute open'),
    high: toNumber(kline[2], 'minute high'),
    low: toNumber(kline[3], 'minute low'),
    close: toNumber(kline[4], 'minute close'),
    volume: toNumber(kline[5], 'minute volume'),
  }));
}

function getDayBucketStart(bucketStartMillis: bigint) {
  return Math.floor(Number(bucketStartMillis) / MS_PER_DAY) * MS_PER_DAY;
}

function mergeDayCandle(existing: CandleInput | null, candle: CandleInput) {
  if (!existing) {
    return {
      ...candle,
      bucketStartMillis: BigInt(getDayBucketStart(candle.bucketStartMillis)),
    };
  }

  existing.high = Math.max(existing.high, candle.high);
  existing.low = Math.min(existing.low, candle.low);
  existing.close = candle.close;
  existing.volume += candle.volume;

  return existing;
}

export async function seedMinuteCandles(
  connection: DbConnection,
  minuteCandles: readonly CandleInput[],
  chunkSize: number,
) {
  for (let offset = 0; offset < minuteCandles.length; offset += chunkSize) {
    const candles = minuteCandles.slice(offset, offset + chunkSize);
    await connection.reducers.upsertExternalMinuteCandles({ candles });
  }
}

export async function seedDayCandles(
  connection: DbConnection,
  dayCandles: readonly CandleInput[],
  chunkSize: number,
) {
  for (let offset = 0; offset < dayCandles.length; offset += chunkSize) {
    const candles = dayCandles.slice(offset, offset + chunkSize);
    await connection.reducers.upsertExternalDayCandles({ candles });
  }
}

export async function replayMarketHistory(
  connection: DbConnection,
  config: IngestConfig,
  market: IngestMarketConfig,
  startTime: number,
  endTime: number,
) {
  let minuteCount = 0;
  const dayCandlesByBucket = new Map<number, CandleInput>();

  for await (const klineBatch of fetchHistoricalKlineBatches(config, market, startTime, endTime)) {
    const minuteCandles = buildMinuteCandleInputs(market.marketId, klineBatch);

    if (minuteCandles.length === 0) {
      continue;
    }

    await seedMinuteCandles(connection, minuteCandles, config.historySeedChunkSize);
    minuteCount += minuteCandles.length;

    for (const minuteCandle of minuteCandles) {
      const dayBucketStart = getDayBucketStart(minuteCandle.bucketStartMillis);
      const existingDayCandle = dayCandlesByBucket.get(dayBucketStart) ?? null;
      const nextDayCandle = mergeDayCandle(existingDayCandle, minuteCandle);
      dayCandlesByBucket.set(dayBucketStart, nextDayCandle);
    }
  }

  const dayCandles = Array.from(dayCandlesByBucket.values()).sort(
    (left, right) => Number(left.bucketStartMillis - right.bucketStartMillis)
  );

  if (dayCandles.length > 0) {
    await seedDayCandles(connection, dayCandles, config.historySeedChunkSize);
  }

  return {
    minuteCount,
    dayCount: dayCandles.length,
  };
}

export async function reseedMarketHistoryRange(
  connection: DbConnection,
  config: IngestConfig,
  market: IngestMarketConfig,
  startTime: number,
  endTime: number,
) {
  await connection.reducers.deleteExternalCandlesInRange({
    marketId: market.marketId,
    startMillisInclusive: BigInt(startTime),
    endMillisExclusive: BigInt(endTime),
  });

  return replayMarketHistory(connection, config, market, startTime, endTime);
}

export async function seedLiveSnapshot(
  connection: DbConnection,
  config: IngestConfig,
  market: IngestMarketConfig,
) {
  const tickerUrl = new URL('/api/v3/ticker/24hr', config.binanceRestBaseUrl);
  tickerUrl.searchParams.set('symbol', market.binanceSymbol.toUpperCase());

  const depthUrl = new URL('/api/v3/depth', config.binanceRestBaseUrl);
  depthUrl.searchParams.set('symbol', market.binanceSymbol.toUpperCase());
  depthUrl.searchParams.set('limit', String(config.orderBookLevels));

  const [ticker, depth] = await Promise.all([
    fetchJson<BinanceTickerSnapshot>(tickerUrl.toString()),
    fetchJson<BinanceDepthSnapshot>(depthUrl.toString()),
  ]);

  await connection.reducers.ingestExternalMarketSnapshot({
    marketId: market.marketId,
    price: toNumber(ticker.lastPrice, 'ticker last price'),
    open24H: toNumber(ticker.openPrice, 'ticker open price'),
    high24H: toNumber(ticker.highPrice, 'ticker high price'),
    low24H: toNumber(ticker.lowPrice, 'ticker low price'),
    change24H: toNumber(ticker.priceChangePercent, 'ticker price change percent'),
    volume24H: toNumber(ticker.volume, 'ticker volume'),
    updatedAtMillis: BigInt(ticker.closeTime),
  });

  await connection.reducers.replaceExternalOrderBook({
    marketId: market.marketId,
    updatedAtMillis: BigInt(Date.now()),
    bids: depth.bids.map(([price, size], index) => ({
      level: index,
      price: toNumber(price, 'depth bid price'),
      size: toNumber(size, 'depth bid size'),
    })),
    asks: depth.asks.map(([price, size], index) => ({
      level: index,
      price: toNumber(price, 'depth ask price'),
      size: toNumber(size, 'depth ask size'),
    })),
  });
}
import { DbConnection, type ErrorContext } from '../../src/module_bindings';
import { getSpacetimeIngestToken } from './auth0';
import { loadConfig, type IngestConfig, type IngestMarketConfig } from './config';

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

type CandleInput = {
  marketId: number;
  bucketStartMillis: bigint;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function setFailureExitCode() {
  const processLike = (
    globalThis as {
      process?: {
        exitCode?: number;
      };
    }
  ).process;

  if (processLike) {
    processLike.exitCode = 1;
  }
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const BINANCE_KLINE_LIMIT = 1000;

function toNumber(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

async function connectSpacetime(config: IngestConfig) {
  const token = await getSpacetimeIngestToken(config);

  return new Promise<DbConnection>((resolve, reject) => {
    let settled = false;

    const connection = DbConnection.builder()
      .withUri(config.spacetimedbHost)
      .withDatabaseName(config.spacetimedbDatabase)
      .withToken(token)
      .onConnect(conn => {
        if (!settled) {
          settled = true;
          resolve(conn);
        }
      })
      .onConnectError((_ctx: ErrorContext, error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      })
      .build();

    void connection;
  });
}

async function bootstrapMarkets(connection: DbConnection, config: IngestConfig) {
  for (const market of config.markets) {
    await connection.reducers.bootstrapExternalMarket({
      marketId: market.marketId,
      symbol: market.symbol,
      baseAsset: market.baseAsset,
      quoteAsset: market.quoteAsset,
      assetClass: market.assetClass,
      precision: market.precision,
      spreadBps: market.spreadBps,
      changeRate: market.changeRate,
      quoteIntervalMs: market.quoteIntervalMs,
    });
  }
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function* fetchHistoricalKlineBatches(
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

function buildMinuteCandleInputs(marketId: number, klines: readonly BinanceKlineRow[]) {
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

async function seedMinuteCandles(
  connection: DbConnection,
  minuteCandles: readonly CandleInput[],
  chunkSize: number,
) {
  for (let offset = 0; offset < minuteCandles.length; offset += chunkSize) {
    const candles = minuteCandles.slice(offset, offset + chunkSize);
    await connection.reducers.upsertExternalMinuteCandles({ candles });
  }
}

async function seedDayCandles(
  connection: DbConnection,
  dayCandles: readonly CandleInput[],
  chunkSize: number,
) {
  for (let offset = 0; offset < dayCandles.length; offset += chunkSize) {
    const candles = dayCandles.slice(offset, offset + chunkSize);
    await connection.reducers.upsertExternalDayCandles({ candles });
  }
}

async function seedLiveSnapshot(
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

async function seedMarketHistory(
  connection: DbConnection,
  config: IngestConfig,
  market: IngestMarketConfig,
) {
  const endTime = Date.now();
  const startTime = endTime - config.historySeedDays * MS_PER_DAY;
  let minuteCount = 0;
  let dayCount = 0;
  let pendingDayBucketStart: number | null = null;
  let pendingMinuteCandles: CandleInput[] = [];
  let pendingDayCandle: CandleInput | null = null;

  const flushPendingDay = async () => {
    if (pendingMinuteCandles.length === 0 || !pendingDayCandle) {
      return;
    }

    await seedMinuteCandles(connection, pendingMinuteCandles, config.historySeedChunkSize);
    await seedDayCandles(connection, [pendingDayCandle], config.historySeedChunkSize);
    dayCount += 1;
    pendingMinuteCandles = [];
    pendingDayCandle = null;
    pendingDayBucketStart = null;
  };

  for await (const klineBatch of fetchHistoricalKlineBatches(config, market, startTime, endTime)) {
    const minuteCandles = buildMinuteCandleInputs(market.marketId, klineBatch);

    for (const candle of minuteCandles) {
      const dayBucketStart = getDayBucketStart(candle.bucketStartMillis);

      if (pendingDayBucketStart !== null && dayBucketStart !== pendingDayBucketStart) {
        await flushPendingDay();
      }

      pendingDayBucketStart = dayBucketStart;
      pendingMinuteCandles.push(candle);
      pendingDayCandle = mergeDayCandle(pendingDayCandle, candle);
      minuteCount += 1;
    }
  }

  await flushPendingDay();

  console.log('[binance-seed] Seeding history', {
    symbol: market.binanceSymbol,
    minutes: minuteCount,
    days: dayCount,
  });

  await seedLiveSnapshot(connection, config, market);
}

async function main() {
  const config = loadConfig();
  const connection = await connectSpacetime(config);

  try {
    await bootstrapMarkets(connection, config);

    for (const market of config.markets) {
      await seedMarketHistory(connection, config, market);
    }
  } finally {
    connection.disconnect();
  }
}

void main().catch(error => {
  console.error('[binance-seed] Fatal error', error);
  setFailureExitCode();
});
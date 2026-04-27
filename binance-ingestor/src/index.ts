import { DbConnection, type ErrorContext } from '../../src/module_bindings';
import { getSpacetimeIngestToken } from './auth0';
import { loadConfig, type IngestConfig, type IngestMarketConfig } from './config';

type BinanceCombinedStreamMessage = {
  stream: string;
  data: unknown;
};

type BinanceTickerEvent = {
  e: '24hrTicker';
  E: number;
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  P: string;
  v: string;
};

type BinanceDepthSnapshotEvent = {
  lastUpdateId: number;
  bids?: [string, string][];
  asks?: [string, string][];
  b?: [string, string][];
  a?: [string, string][];
};

type BinanceKlineEvent = {
  e: 'kline';
  E: number;
  s: string;
  k: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
  };
};

type PendingTickerState = {
  marketId: number;
  price: number;
  open24H: number;
  high24H: number;
  low24H: number;
  change24H: number;
  volume24H: number;
  updatedAtMillis: bigint;
};

type PendingOrderBookLevel = {
  level: number;
  price: number;
  size: number;
};

type PendingOrderBookState = {
  marketId: number;
  updatedAtMillis: bigint;
  bids: PendingOrderBookLevel[];
  asks: PendingOrderBookLevel[];
};

type PendingMinuteCandleState = {
  marketId: number;
  bucketStartMillis: bigint;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type MarketPendingState = {
  ticker?: PendingTickerState;
  orderBook?: PendingOrderBookState;
  minuteCandle?: PendingMinuteCandleState;
};

type RuntimeState = {
  reconnectAttempt: number;
  lastBinanceOpenAt: number | null;
  lastBinanceMessageAt: number | null;
  lastSpacetimeOpenAt: number | null;
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

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createRuntimeState(): RuntimeState {
  return {
    reconnectAttempt: 0,
    lastBinanceOpenAt: null,
    lastBinanceMessageAt: null,
    lastSpacetimeOpenAt: null,
  };
}

function createMarketLookup(markets: readonly IngestMarketConfig[]) {
  return new Map(markets.map(market => [market.binanceSymbol, market]));
}

function buildStreamUrl(config: IngestConfig) {
  const streams = config.markets.flatMap(market => [
    `${market.binanceSymbol}@ticker`,
    `${market.binanceSymbol}@depth${config.orderBookLevels}@1000ms`,
    `${market.binanceSymbol}@kline_1m`,
  ]);

  return `${config.binanceWsBaseUrl}?streams=${streams.join('/')}`;
}


async function connectSpacetime(config: IngestConfig) {
  const token = await getSpacetimeIngestToken(config);

  return new Promise<{
    connection: DbConnection;
    disconnected: Promise<void>;
  }>((resolve, reject) => {
    let settled = false;
    let resolveDisconnected!: () => void;
    const disconnected = new Promise<void>(resolveDisconnect => {
      resolveDisconnected = resolveDisconnect;
    });

    const connection = DbConnection.builder()
      .withUri(config.spacetimedbHost)
      .withDatabaseName(config.spacetimedbDatabase)
      .withToken(token)
      .onConnect(conn => {
        if (!settled) {
          settled = true;
          resolve({
            connection: conn,
            disconnected,
          });
        }
      })
      .onDisconnect(() => {
        resolveDisconnected();
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

function parseCombinedStreamMessage(rawMessage: string): BinanceCombinedStreamMessage | null {
  const parsed = JSON.parse(rawMessage) as unknown;

  if (!parsed || typeof parsed !== 'object' || !('stream' in parsed) || !('data' in parsed)) {
    return null;
  }

  return parsed as BinanceCombinedStreamMessage;
}

function toNumber(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function extractMarket(streamName: string, lookup: ReadonlyMap<string, IngestMarketConfig>) {
  const [symbol] = streamName.split('@');

  if (!symbol) {
    return undefined;
  }

  return lookup.get(symbol.toLowerCase());
}

class ReducerBatcher {
  private readonly pendingByMarket = new Map<number, MarketPendingState>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushInFlight = Promise.resolve();
  private stopped = false;
  private flushError: unknown;

  constructor(
    private readonly connection: DbConnection,
    private readonly config: IngestConfig,
    private readonly onFlushError?: (error: unknown) => void,
  ) {}

  stageTicker(nextTicker: PendingTickerState) {
    const pendingState = this.getPendingState(nextTicker.marketId);
    pendingState.ticker = nextTicker;
    this.scheduleFlush();
  }

  stageOrderBook(nextOrderBook: PendingOrderBookState) {
    const pendingState = this.getPendingState(nextOrderBook.marketId);
    pendingState.orderBook = nextOrderBook;
    this.scheduleFlush();
  }

  stageMinuteCandle(nextMinuteCandle: PendingMinuteCandleState) {
    const pendingState = this.getPendingState(nextMinuteCandle.marketId);
    pendingState.minuteCandle = nextMinuteCandle;
    this.scheduleFlush();
  }

  async flushNow() {
    if (this.flushError) {
      throw this.flushError;
    }

    if (this.pendingByMarket.size === 0) {
      return;
    }

    const pendingEntries = Array.from(this.pendingByMarket.entries());
    this.pendingByMarket.clear();

    try {
      for (const [, pendingState] of pendingEntries) {
        if (pendingState.ticker) {
          await this.connection.reducers.ingestExternalMarketSnapshot(pendingState.ticker);
        }

        if (pendingState.orderBook) {
          await this.connection.reducers.replaceExternalOrderBook(pendingState.orderBook);
        }

        if (pendingState.minuteCandle) {
          await this.connection.reducers.upsertExternalMinuteCandle(pendingState.minuteCandle);
        }
      }
    } catch (error) {
      for (const [marketId, pendingState] of pendingEntries) {
        const existing = this.pendingByMarket.get(marketId);
        this.pendingByMarket.set(marketId, {
          ticker: pendingState.ticker ?? existing?.ticker,
          orderBook: pendingState.orderBook ?? existing?.orderBook,
          minuteCandle: pendingState.minuteCandle ?? existing?.minuteCandle,
        });
      }

      throw error;
    }
  }

  async stop() {
    this.stopped = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    await this.flushInFlight;

    if (this.flushError) {
      throw this.flushError;
    }

    await this.flushNow();
  }

  private getPendingState(marketId: number) {
    const existing = this.pendingByMarket.get(marketId);

    if (existing) {
      return existing;
    }

    const nextState: MarketPendingState = {};
    this.pendingByMarket.set(marketId, nextState);
    return nextState;
  }

  private scheduleFlush() {
    if (this.stopped || this.flushTimer) {
      return;
    }

    const jitterWindow = this.config.reducerFlushJitterMs;
    const jitter = jitterWindow > 0 ? Math.floor(Math.random() * (jitterWindow + 1)) : 0;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushInFlight = this.flushInFlight
        .then(() => this.flushNow())
        .catch(error => {
          console.error('[binance-ingestor] Failed to flush reducer batch', error);
          this.flushError = error;
          this.onFlushError?.(error);
        });
    }, this.config.reducerFlushIntervalMs + jitter);
  }
}

function handleTickerEvent(
  batcher: ReducerBatcher,
  market: IngestMarketConfig,
  event: BinanceTickerEvent
) {
  batcher.stageTicker({
    marketId: market.marketId,
    price: toNumber(event.c, 'ticker close price'),
    open24H: toNumber(event.o, 'ticker open price'),
    high24H: toNumber(event.h, 'ticker high price'),
    low24H: toNumber(event.l, 'ticker low price'),
    change24H: toNumber(event.P, 'ticker change percent'),
    volume24H: toNumber(event.v, 'ticker base volume'),
    updatedAtMillis: BigInt(event.E),
  });
}

function handleDepthEvent(
  batcher: ReducerBatcher,
  market: IngestMarketConfig,
  event: BinanceDepthSnapshotEvent
) {
  const bids = (event.bids ?? event.b ?? []).map(([price, size], index) => ({
    level: index,
    price: toNumber(price, 'bid price'),
    size: toNumber(size, 'bid size'),
  }));
  const asks = (event.asks ?? event.a ?? []).map(([price, size], index) => ({
    level: index,
    price: toNumber(price, 'ask price'),
    size: toNumber(size, 'ask size'),
  }));

  batcher.stageOrderBook({
    marketId: market.marketId,
    updatedAtMillis: BigInt(Date.now()),
    bids,
    asks,
  });
}

function handleKlineEvent(
  batcher: ReducerBatcher,
  market: IngestMarketConfig,
  event: BinanceKlineEvent
) {
  batcher.stageMinuteCandle({
    marketId: market.marketId,
    bucketStartMillis: BigInt(event.k.t),
    open: toNumber(event.k.o, 'kline open'),
    high: toNumber(event.k.h, 'kline high'),
    low: toNumber(event.k.l, 'kline low'),
    close: toNumber(event.k.c, 'kline close'),
    volume: toNumber(event.k.v, 'kline volume'),
  });
}

async function runBinanceLoop(
  connection: DbConnection,
  config: IngestConfig,
  state: RuntimeState,
  disconnected: Promise<void>
) {
  const marketLookup = createMarketLookup(config.markets);
  const streamUrl = buildStreamUrl(config);
  let cycleError: unknown;
  let socket: WebSocket | null = null;
  const batcher = new ReducerBatcher(connection, config, error => {
    cycleError = error;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close(4003, 'reducer-flush-failure');
    }
  });

  try {
    await new Promise<void>(resolve => {
      socket = new WebSocket(streamUrl);
      const forcedRotationTimer = setTimeout(() => {
        console.warn('[binance-ingestor] Rotating Binance session before the 24 hour limit');
        socket?.close(4000, 'session-rotation');
      }, config.binanceSessionMaxLifetimeMs);
      const staleWatchdogTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN || state.lastBinanceOpenAt == null) {
          return;
        }

        const lastActivityAt = state.lastBinanceMessageAt ?? state.lastBinanceOpenAt;
        const idleForMs = Date.now() - lastActivityAt;

        if (idleForMs < config.binanceStaleMessageTimeoutMs) {
          return;
        }

        console.warn('[binance-ingestor] Binance websocket appears stale, restarting ingest cycle', {
          idleForMs,
          timeoutMs: config.binanceStaleMessageTimeoutMs,
        });
        socket.close(4002, 'stale-binance-session');
      }, Math.min(config.binanceStaleMessageTimeoutMs, 30_000));

      const cleanup = () => {
        clearTimeout(forcedRotationTimer);
        clearInterval(staleWatchdogTimer);
      };

      disconnected.then(() => {
        console.warn('[binance-ingestor] SpacetimeDB disconnected, restarting ingest cycle');
        socket?.close(4001, 'spacetimedb-disconnect');
      }).catch(() => {
        socket?.close(4001, 'spacetimedb-disconnect');
      });

      socket.addEventListener('open', () => {
        state.lastBinanceOpenAt = Date.now();
        state.lastBinanceMessageAt = null;
        console.log('[binance-ingestor] Connected to Binance combined stream', streamUrl);
      });

      socket.addEventListener('message', event => {
        try {
          state.lastBinanceMessageAt = Date.now();
          const message = parseCombinedStreamMessage(String(event.data));

          if (!message) {
            return;
          }

          const market = extractMarket(message.stream, marketLookup);

          if (!market) {
            return;
          }

          if (message.stream.endsWith('@ticker')) {
            handleTickerEvent(batcher, market, message.data as BinanceTickerEvent);
            return;
          }

          if (message.stream.includes('@depth')) {
            handleDepthEvent(batcher, market, message.data as BinanceDepthSnapshotEvent);
            return;
          }

          if (message.stream.endsWith('@kline_1m')) {
            handleKlineEvent(batcher, market, message.data as BinanceKlineEvent);
          }
        } catch (error) {
          console.error('[binance-ingestor] Failed to process Binance message', error);
        }
      });

      socket.addEventListener('error', event => {
        console.error('[binance-ingestor] Binance websocket error', event);
      });

      socket.addEventListener('close', event => {
        cleanup();
        console.warn('[binance-ingestor] Binance websocket closed', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        resolve();
      });
    });
  } finally {
    try {
      await batcher.stop();
    } catch (error) {
      cycleError ??= error;
    }

    socket = null;
    state.lastBinanceOpenAt = null;
    state.lastBinanceMessageAt = null;
  }

  if (cycleError) {
    throw cycleError;
  }
}

async function main() {
  const config = loadConfig();
  const state = createRuntimeState();

  for (;;) {
    try {
      const { connection, disconnected } = await connectSpacetime(config);
      state.lastSpacetimeOpenAt = Date.now();
      state.reconnectAttempt = 0;

      console.log('[binance-ingestor] Connected to SpacetimeDB', {
        host: config.spacetimedbHost,
        database: config.spacetimedbDatabase,
        marketCount: config.markets.length,
      });

      await bootstrapMarkets(connection, config);
      await runBinanceLoop(connection, config, state, disconnected);
      connection.disconnect();
    } catch (error) {
      state.reconnectAttempt += 1;
      console.error('[binance-ingestor] Ingest cycle failed', {
        reconnectAttempt: state.reconnectAttempt,
        error,
      });
    }

    await delay(config.reconnectDelayMs);
  }
}

void main().catch(error => {
  console.error('[binance-ingestor] Fatal error', error);
  setFailureExitCode();
});
export type IngestMarketConfig = {
  binanceSymbol: string;
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

export type IngestConfig = {
  spacetimedbHost: string;
  spacetimedbDatabase: string;
  binanceWsBaseUrl: string;
  binanceRestBaseUrl: string;
  orderBookLevels: 5 | 10 | 20;
  reconnectDelayMs: number;
  binanceStaleMessageTimeoutMs: number;
  reducerFlushIntervalMs: number;
  reducerFlushJitterMs: number;
  binanceSessionMaxLifetimeMs: number;
  historySeedDays: number;
  historySeedChunkSize: number;
  markets: IngestMarketConfig[];
  auth0Domain: string;
  auth0Audience: string;
  auth0Scope: string;
  auth0ClientId: string;
  auth0ClientSecret: string;
};

const DEFAULT_MARKETS: Record<string, IngestMarketConfig> = {
  btcusdt: {
    binanceSymbol: 'btcusdt',
    marketId: 1,
    symbol: 'BTC/USD',
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    assetClass: 'Crypto',
    precision: 2,
    spreadBps: 3.5,
    changeRate: 0.0017,
    quoteIntervalMs: 1000,
  },
  ethusdt: {
    binanceSymbol: 'ethusdt',
    marketId: 2,
    symbol: 'ETH/USD',
    baseAsset: 'ETH',
    quoteAsset: 'USD',
    assetClass: 'Crypto',
    precision: 2,
    spreadBps: 4.2,
    changeRate: 0.0022,
    quoteIntervalMs: 1000,
  },
  solusdt: {
    binanceSymbol: 'solusdt',
    marketId: 3,
    symbol: 'SOL/USD',
    baseAsset: 'SOL',
    quoteAsset: 'USD',
    assetClass: 'Crypto',
    precision: 2,
    spreadBps: 6.8,
    changeRate: 0.0034,
    quoteIntervalMs: 1000,
  },
};

function getEnv(name: string) {
  return (
    globalThis as {
      process?: {
        env?: Record<string, string | undefined>;
      };
    }
  ).process?.env?.[name];
}

function requireEnv(name: string) {
  const value = getEnv(name)?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function parseOrderBookLevels(value: string | undefined): 5 | 10 | 20 {
  const normalized = Number(value ?? 20);

  if (normalized === 5 || normalized === 10 || normalized === 20) {
    return normalized;
  }

  throw new Error('BINANCE_ORDER_BOOK_LEVELS must be one of 5, 10, or 20.');
}

function parseReconnectDelayMs(value: string | undefined) {
  const normalized = Number(value ?? 5000);

  if (!Number.isFinite(normalized) || normalized < 1000) {
    throw new Error('BINANCE_RECONNECT_DELAY_MS must be at least 1000 milliseconds.');
  }

  return normalized;
}

function parsePositiveInteger(
  value: string | undefined,
  fallbackValue: number,
  label: string,
  minimumValue = 1
) {
  const normalized = Number(value ?? fallbackValue);

  if (!Number.isInteger(normalized) || normalized < minimumValue) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimumValue}.`);
  }

  return normalized;
}

function parseMarkets(value: string | undefined) {
  const requestedSymbols = (value ?? 'btcusdt,ethusdt,solusdt')
    .split(',')
    .map(symbol => symbol.trim().toLowerCase())
    .filter(Boolean);

  if (requestedSymbols.length === 0) {
    throw new Error('BINANCE_SYMBOLS must include at least one supported symbol.');
  }

  return requestedSymbols.map(symbol => {
    const market = DEFAULT_MARKETS[symbol];

    if (!market) {
      throw new Error(`Unsupported BINANCE_SYMBOLS entry: ${symbol}`);
    }

    return market;
  });
}

function buildIngestScope() {
  const configuredScope =
    getEnv('SPACETIMEDB_INGEST_SCOPE')?.trim() ||
    getEnv('AUTH0_SCOPE')?.trim() ||
    '';
  const scopeParts = configuredScope
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (!scopeParts.includes('market:ingest')) {
    scopeParts.push('market:ingest');
  }

  return scopeParts.join(' ');
}


export function loadConfig(): IngestConfig {
  return {
    spacetimedbHost:
      getEnv('SPACETIMEDB_HOST')?.trim() ||
      getEnv('NEXT_PUBLIC_SPACETIMEDB_HOST')?.trim() ||
      'ws://localhost:3000',
    spacetimedbDatabase:
      getEnv('SPACETIMEDB_DB_NAME')?.trim() ||
      getEnv('NEXT_PUBLIC_SPACETIMEDB_DB_NAME')?.trim() ||
      'nextjs-ts',
    binanceWsBaseUrl:
      getEnv('BINANCE_WS_BASE_URL')?.trim() ||
      'wss://stream.binance.com:9443/stream',
    binanceRestBaseUrl:
      getEnv('BINANCE_REST_BASE_URL')?.trim() ||
      'https://api.binance.com',
    orderBookLevels: parseOrderBookLevels(getEnv('BINANCE_ORDER_BOOK_LEVELS')),
    reconnectDelayMs: parseReconnectDelayMs(getEnv('BINANCE_RECONNECT_DELAY_MS')),
    binanceStaleMessageTimeoutMs: parsePositiveInteger(
      getEnv('BINANCE_STALE_MESSAGE_TIMEOUT_MS'),
      90_000,
      'BINANCE_STALE_MESSAGE_TIMEOUT_MS',
      30_000
    ),
    reducerFlushIntervalMs: parsePositiveInteger(
      getEnv('BINANCE_REDUCER_FLUSH_INTERVAL_MS'),
      750,
      'BINANCE_REDUCER_FLUSH_INTERVAL_MS',
      50
    ),
    reducerFlushJitterMs: parsePositiveInteger(
      getEnv('BINANCE_REDUCER_FLUSH_JITTER_MS'),
      150,
      'BINANCE_REDUCER_FLUSH_JITTER_MS',
      0
    ),
    binanceSessionMaxLifetimeMs: parsePositiveInteger(
      getEnv('BINANCE_SESSION_MAX_LIFETIME_MS'),
      23 * 60 * 60 * 1000,
      'BINANCE_SESSION_MAX_LIFETIME_MS',
      60_000
    ),
    historySeedDays: parsePositiveInteger(
      getEnv('BINANCE_HISTORY_SEED_DAYS'),
      3,
      'BINANCE_HISTORY_SEED_DAYS'
    ),
    historySeedChunkSize: parsePositiveInteger(
      getEnv('BINANCE_HISTORY_SEED_CHUNK_SIZE'),
      500,
      'BINANCE_HISTORY_SEED_CHUNK_SIZE',
      1
    ),
    markets: parseMarkets(getEnv('BINANCE_SYMBOLS')),
    auth0Domain: requireEnv('AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    auth0Audience:
      getEnv('AUTH0_AUDIENCE')?.trim() ||
      getEnv('NEXT_PUBLIC_AUTH0_AUDIENCE')?.trim() ||
      'https://my-exness-spacetimedb',
    auth0Scope: buildIngestScope(),
    auth0ClientId:
      getEnv('SPACETIMEDB_INGEST_CLIENT_ID')?.trim() ||
      requireEnv('AUTH0_CLIENT_ID'),
    auth0ClientSecret:
      getEnv('SPACETIMEDB_INGEST_CLIENT_SECRET')?.trim() ||
      requireEnv('AUTH0_CLIENT_SECRET'),
  };
}
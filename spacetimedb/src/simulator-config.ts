const QUOTE_INTERVAL_MS = 1000;
const MINUTE_HISTORY_COUNT = 50 * 24 * 60;
const DAY_HISTORY_COUNT = 50;
const MINUTES_IN_24H = 24 * 60;
const MAX_MINUTE_CANDLES_PER_MARKET = MINUTE_HISTORY_COUNT * 2;
const MAX_DAY_CANDLES_PER_MARKET = DAY_HISTORY_COUNT * 2;
const ORDER_BOOK_LEVELS_PER_SIDE = 4;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const RNG_MASK = (BigInt(1) << BigInt(64)) - BigInt(1);
const AUTH0_ISSUER = 'https://exness-auth.jp.auth0.com/';
const AUTH0_AUDIENCE = 'https://my-exness-spacetimedb';
const RESET_SIMULATION_PERMISSION = 'simulation:reset';
const DEFAULT_ACCOUNT_CURRENCY = 'USD';
const DEFAULT_ACCOUNT_BALANCE = 10_000;
const DEFAULT_ACCOUNT_LEVERAGE = 200;

type SeedMarket = {
  id: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  assetClass: string;
  basePrice: number;
  drift: number;
  changeRate: number;
  minPrice: number;
  baseVolume: number;
  precision: number;
  spreadBps: number;
};

type CandleRow = {
  id: bigint;
  marketId: number;
  bucketStart: import('spacetimedb').Timestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type MarketSnapshotRow = {
  marketId: number;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  change24h: number;
  volume24h: number;
  updatedAt: import('spacetimedb').Timestamp;
};

type MarketOrderBookLevelRow = {
  id: bigint;
  marketId: number;
  isBid: boolean;
  level: number;
  price: number;
  size: number;
  updatedAt: import('spacetimedb').Timestamp;
};

type UserProfileRow = {
  auth0UserId: string;
  senderIdentity: import('spacetimedb').Identity;
  displayName: string;
  email: string;
  createdAt: import('spacetimedb').Timestamp;
  updatedAt: import('spacetimedb').Timestamp;
};

type TradingAccountRow = {
  auth0UserId: string;
  currency: string;
  balance: number;
  reservedBalance: number;
  updatedAt: import('spacetimedb').Timestamp;
};

type TradingPositionRow = {
  id: string;
  auth0UserId: string;
  marketId: number;
  quantity: number;
  reservedQuantity: number;
  averageEntryPrice: number;
  updatedAt: import('spacetimedb').Timestamp;
};

type TradeOrderRow = {
  id: bigint;
  auth0UserId: string;
  marketId: number;
  side: string;
  orderType: string;
  status: string;
  quantity: number;
  limitPrice: number | undefined;
  filledPrice: number | undefined;
  createdAt: import('spacetimedb').Timestamp;
  updatedAt: import('spacetimedb').Timestamp;
  filledAt: import('spacetimedb').Timestamp | undefined;
};

const SEED_MARKETS: SeedMarket[] = [
  {
    id: 1,
    symbol: 'BTC/USD',
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    assetClass: 'Crypto',
    basePrice: 68420,
    drift: 0.00009,
    changeRate: 0.0017,
    minPrice: 10000,
    baseVolume: 180,
    precision: 2,
    spreadBps: 3.5,
  },
  {
    id: 2,
    symbol: 'ETH/USD',
    baseAsset: 'ETH',
    quoteAsset: 'USD',
    assetClass: 'Crypto',
    basePrice: 3385,
    drift: 0.00007,
    changeRate: 0.0022,
    minPrice: 500,
    baseVolume: 960,
    precision: 2,
    spreadBps: 4.2,
  },
  {
    id: 3,
    symbol: 'SOL/USD',
    baseAsset: 'SOL',
    quoteAsset: 'USD',
    assetClass: 'Crypto',
    basePrice: 154.4,
    drift: 0.00011,
    changeRate: 0.0034,
    minPrice: 20,
    baseVolume: 6200,
    precision: 2,
    spreadBps: 6.8,
  },
  {
    id: 4,
    symbol: 'XAU/USD',
    baseAsset: 'XAU',
    quoteAsset: 'USD',
    assetClass: 'Metal',
    basePrice: 2368.7,
    drift: 0.00003,
    changeRate: 0.00055,
    minPrice: 1500,
    baseVolume: 820,
    precision: 2,
    spreadBps: 2.1,
  },
  {
    id: 5,
    symbol: 'EUR/USD',
    baseAsset: 'EUR',
    quoteAsset: 'USD',
    assetClass: 'FX',
    basePrice: 1.0864,
    drift: 0.00001,
    changeRate: 0.00012,
    minPrice: 0.7,
    baseVolume: 125000,
    precision: 5,
    spreadBps: 1.4,
  },
];

const SEED_MARKETS_BY_ID = new Map(SEED_MARKETS.map(market => [market.id, market]));

export {
  AUTH0_AUDIENCE,
  AUTH0_ISSUER,
  DAY_HISTORY_COUNT,
  DEFAULT_ACCOUNT_BALANCE,
  DEFAULT_ACCOUNT_LEVERAGE,
  DEFAULT_ACCOUNT_CURRENCY,
  MAX_DAY_CANDLES_PER_MARKET,
  MAX_MINUTE_CANDLES_PER_MARKET,
  MINUTES_IN_24H,
  MINUTE_HISTORY_COUNT,
  MS_PER_DAY,
  MS_PER_MINUTE,
  ORDER_BOOK_LEVELS_PER_SIDE,
  QUOTE_INTERVAL_MS,
  RESET_SIMULATION_PERMISSION,
  RNG_MASK,
  SEED_MARKETS,
  SEED_MARKETS_BY_ID,
};

export type {
  CandleRow,
  MarketOrderBookLevelRow,
  MarketSnapshotRow,
  SeedMarket,
  TradeOrderRow,
  TradingAccountRow,
  TradingPositionRow,
  UserProfileRow,
};
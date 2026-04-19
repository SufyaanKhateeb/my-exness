import { ScheduleAt, Timestamp } from 'spacetimedb';
import { SenderError, schema, table, t, type ReducerCtx, Range } from 'spacetimedb/server';

const QUOTE_INTERVAL_MS = 600;
const MINUTE_HISTORY_COUNT = 400 * 24 * 60;
const DAY_HISTORY_COUNT = 400;
const MINUTES_IN_24H = 24 * 60;
const MAX_MINUTE_CANDLES_PER_MARKET = MINUTE_HISTORY_COUNT * 2;
const MAX_DAY_CANDLES_PER_MARKET = DAY_HISTORY_COUNT * 2;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const RNG_MASK = (1n << 64n) - 1n;
const AUTH0_ISSUER = 'https://exness-auth.jp.auth0.com/';
const AUTH0_AUDIENCE = 'https://my-exness-spacetimedb';
const RESET_SIMULATION_PERMISSION = 'simulation:reset';

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
  bucketStart: Timestamp;
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
  updatedAt: Timestamp;
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

const marketTickScheduleRow = t.row('MarketTickSchedule', {
  scheduled_id: t.u64().primaryKey().autoInc(),
  scheduled_at: t.scheduleAt(),
  tickIntervalMs: t.u32(),
});

const marketTickSchedule = table(
  {
    name: 'market_tick_schedule',
    // SpacetimeDB schedule tables require a direct reducer reference here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scheduled: (): any => tickMarkets,
  },
  marketTickScheduleRow
);

const spacetimedb = schema({
  person: table(
    { public: true },
    {
      name: t.string(),
    }
  ),
  market: table(
    { public: true },
    {
      id: t.u32().primaryKey(),
      symbol: t.string().unique(),
      baseAsset: t.string(),
      quoteAsset: t.string(),
      assetClass: t.string(),
      spreadBps: t.f64(),
      changeRate: t.f64(),
      quoteIntervalMs: t.u32(),
      precision: t.u8(),
    }
  ),
  marketSnapshot: table(
    { public: true, name: 'market_snapshot' },
    {
      marketId: t.u32().primaryKey(),
      price: t.f64(),
      open24h: t.f64(),
      high24h: t.f64(),
      low24h: t.f64(),
      change24h: t.f64(),
      volume24h: t.f64(),
      updatedAt: t.timestamp(),
    }
  ),
  marketMinuteCandle: table(
    {
      public: true,
      name: 'market_minute_candle',
      indexes: [
        { accessor: 'market_minute_candle_idx', algorithm: 'btree', columns: ['marketId', 'bucketStart'] },
      ]
    },
    {
      id: t.u64().primaryKey(),
      marketId: t.u32().index(),
      bucketStart: t.timestamp().index(),
      open: t.f64(),
      high: t.f64(),
      low: t.f64(),
      close: t.f64(),
      volume: t.f64(),
    }
  ),
  marketDayCandle: table(
    {
      public: true,
      name: 'market_day_candle',
      indexes: [
        { accessor: 'market_day_candle_idx', algorithm: 'btree', columns: ['marketId', 'bucketStart'] },
      ]
    },
    {
      id: t.u64().primaryKey(),
      marketId: t.u32().index(),
      bucketStart: t.timestamp().index(),
      open: t.f64(),
      high: t.f64(),
      low: t.f64(),
      close: t.f64(),
      volume: t.f64(),
    }
  ),
  marketState: table(
    { name: 'market_state' },
    {
      marketId: t.u32().primaryKey(),
      seed: t.u64(),
      tick: t.u32(),
      minuteCandleId: t.u64(),
      minuteBucketStart: t.timestamp(),
      minuteOpen: t.f64(),
      minuteHigh: t.f64(),
      minuteLow: t.f64(),
      minuteClose: t.f64(),
      minuteVolume: t.f64(),
      dayCandleId: t.u64(),
      dayBucketStart: t.timestamp(),
      dayOpen: t.f64(),
      dayHigh: t.f64(),
      dayLow: t.f64(),
      dayClose: t.f64(),
      dayVolume: t.f64(),
    }
  ),
  marketTickSchedule,
  simulatorState: table(
    { name: 'simulator_state' },
    {
      id: t.u8().primaryKey(),
      nextCandleId: t.u64(),
    }
  ),
});

export default spacetimedb;

type ExchangeCtx = ReducerCtx<typeof spacetimedb.schemaType>;

function claimAsStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function hasScopeClaim(value: unknown, scope: string) {
  if (typeof value !== 'string') {
    return false;
  }

  return value.split(/\s+/).includes(scope);
}

function ensureAuth0Jwt(ctx: ExchangeCtx) {
  const senderAuth = ctx.senderAuth;

  if (senderAuth.isInternal) {
    return null;
  }

  const jwt = senderAuth.jwt;

  if (!jwt) {
    throw new SenderError('Authentication required. Sign in with Auth0 to access this reducer.');
  }

  if (jwt.issuer !== AUTH0_ISSUER) {
    throw new SenderError('Unauthorized issuer. This module only accepts Auth0 tokens from the configured tenant.');
  }

  if (!jwt.audience.includes(AUTH0_AUDIENCE)) {
    throw new SenderError('Invalid Auth0 audience for this SpacetimeDB module.');
  }

  return jwt;
}

function ensurePermission(ctx: ExchangeCtx, permission: string) {
  const jwt = ensureAuth0Jwt(ctx);

  if (!jwt) {
    return;
  }

  const permissions = claimAsStringArray(jwt.fullPayload.permissions);

  if (permissions.includes(permission) || hasScopeClaim(jwt.fullPayload.scope, permission)) {
    return;
  }

  throw new SenderError(`Permission \"${permission}\" is required.`);
}

function timestampFromMillis(value: number) {
  return Timestamp.fromDate(new Date(value));
}

function clampPrice(value: number, minPrice: number) {
  return Math.max(minPrice, value);
}

function nextSeed(seed: bigint) {
  let value = (seed ^ 0x9e3779b97f4a7c15n) & RNG_MASK;
  value ^= value << 13n;
  value &= RNG_MASK;
  value ^= value >> 7n;
  value &= RNG_MASK;
  value ^= value << 17n;
  return value & RNG_MASK;
}

function unitFloat(seed: bigint) {
  return Number(seed % 1_000_000n) / 1_000_000;
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
  if (delta < 0n) {
    return -1;
  }
  if (delta > 0n) {
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
  const volumeSeed = nextSeed(moveSeed + 31n);
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
  const volumeSeed = nextSeed(moveSeed + 59n);
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
    currentCandleId += 1n;
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
  const minuteRows = Array.from(ctx.db.marketDayCandle.market_day_candle_idx.filter([seedMarket.id, day]));

  const firstRow = minuteRows[0];
  const lastRow = minuteRows[minuteRows.length - 1];

  return {
    marketId: seedMarket.id,
    price: lastRow.close,
    open24h: firstRow.open,
    high24h: minuteRows.reduce((value, row) => Math.max(value, row.high), firstRow.high),
    low24h: minuteRows.reduce((value, row) => Math.min(value, row.low), firstRow.low),
    change24h: ((lastRow.close - firstRow.open) / firstRow.open) * 100,
    volume24h: minuteRows.reduce((value, row) => value + row.volume, 0),
    updatedAt,
  };
}

function seedSimulator(ctx: ExchangeCtx) {
  if (
    ctx.db.market.count() > 0n ||
    ctx.db.marketSnapshot.count() > 0n ||
    ctx.db.marketState.count() > 0n ||
    ctx.db.marketTickSchedule.count() > 0n ||
    ctx.db.simulatorState.count() > 0n
  ) {
    return;
  }

  const now = ctx.timestamp;
  const currentMinuteStart = floorToMinute(now);
  const currentDayStart = floorToDay(now);
  const currentMinuteStartMillis = Number(currentMinuteStart.toMillis());
  let nextCandleId = 1n;

  for (const market of SEED_MARKETS) {
    let minuteSeed = BigInt(market.id) * 7919n;
    let minuteClosePrice = market.basePrice;
    const reverseMinuteRows: CandleRow[] = [];

    for (let offset = 0; offset < MINUTE_HISTORY_COUNT; offset += 1) {
      const next = buildSeedHistoryCandleBackward(
        market,
        nextCandleId,
        minuteClosePrice,
        minuteSeed,
        MINUTE_HISTORY_COUNT - offset,
        timestampFromMillis(currentMinuteStartMillis - offset * MS_PER_MINUTE),
        1.15
      );
      reverseMinuteRows.push(next.candle);
      nextCandleId += 1n;
      minuteSeed = next.seed;
      minuteClosePrice = next.candle.open;
    }

    const minuteRows = reverseMinuteRows.reverse();

    const derivedDayHistory = buildDayCandlesFromMinuteHistory(
      market.id,
      minuteRows,
      nextCandleId,
      minuteRows[minuteRows.length - 1]?.close ?? market.basePrice
    );
    const dayRows = derivedDayHistory.dayRows;
    nextCandleId = derivedDayHistory.nextCandleId;
    const currentDayRow =
      dayRows.find(row => row.bucketStart.toMillis() === currentDayStart.toMillis()) ??
      dayRows[dayRows.length - 1];

    if (!currentDayRow) {
      throw new Error(`Failed to derive current day candle for market ${market.symbol}`);
    }

    for (const row of minuteRows) {
      ctx.db.marketMinuteCandle.insert(row);
    }

    for (const row of dayRows) {
      ctx.db.marketDayCandle.insert(row);
    }

    const currentMinuteRow = minuteRows[minuteRows.length - 1];
    ctx.db.marketState.insert({
      marketId: market.id,
      seed: minuteSeed,
      tick: MINUTE_HISTORY_COUNT,
      minuteCandleId: currentMinuteRow.id,
      minuteBucketStart: currentMinuteRow.bucketStart,
      minuteOpen: currentMinuteRow.open,
      minuteHigh: currentMinuteRow.high,
      minuteLow: currentMinuteRow.low,
      minuteClose: currentMinuteRow.close,
      minuteVolume: currentMinuteRow.volume,
      dayCandleId: currentDayRow.id,
      dayBucketStart: currentDayRow.bucketStart,
      dayOpen: currentDayRow.open,
      dayHigh: currentDayRow.high,
      dayLow: currentDayRow.low,
      dayClose: currentDayRow.close,
      dayVolume: currentDayRow.volume,
    });

    ctx.db.market.insert({
      id: market.id,
      symbol: market.symbol,
      baseAsset: market.baseAsset,
      quoteAsset: market.quoteAsset,
      assetClass: market.assetClass,
      spreadBps: market.spreadBps,
      changeRate: market.changeRate,
      quoteIntervalMs: QUOTE_INTERVAL_MS,
      precision: market.precision,
    });
    ctx.db.marketSnapshot.insert(
      summarizeMarketSnapshot(ctx, market, now)
    );
  }

  ctx.db.simulatorState.insert({
    id: 1,
    nextCandleId,
  });

  ctx.db.marketTickSchedule.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.interval(BigInt(QUOTE_INTERVAL_MS) * 1000n),
    tickIntervalMs: QUOTE_INTERVAL_MS,
  });
}

export const init = spacetimedb.init(ctx => {
  seedSimulator(ctx);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  if (
    ctx.db.market.count() === 0n ||
    ctx.db.marketSnapshot.count() === 0n ||
    ctx.db.marketState.count() === 0n ||
    ctx.db.marketTickSchedule.count() === 0n ||
    ctx.db.simulatorState.count() === 0n
  ) {
    seedSimulator(ctx);
  }

  if (ctx.senderAuth.hasJWT) {
    ensureAuth0Jwt(ctx);
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(() => {
  // No-op for the simulator.
});

export const add = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    ensureAuth0Jwt(ctx);
    ctx.db.person.insert({ name });
  }
);

export const resetSimulation = spacetimedb.reducer(ctx => {
  ensurePermission(ctx, RESET_SIMULATION_PERMISSION);

  for (const schedule of Array.from(ctx.db.marketTickSchedule.iter())) {
    ctx.db.marketTickSchedule.delete(schedule);
  }

  for (const state of Array.from(ctx.db.marketState.iter())) {
    ctx.db.marketState.delete(state);
  }

  for (const row of Array.from(ctx.db.marketMinuteCandle.iter())) {
    ctx.db.marketMinuteCandle.delete(row);
  }

  for (const row of Array.from(ctx.db.marketDayCandle.iter())) {
    ctx.db.marketDayCandle.delete(row);
  }

  for (const snapshot of Array.from(ctx.db.marketSnapshot.iter())) {
    ctx.db.marketSnapshot.delete(snapshot);
  }

  for (const simulator of Array.from(ctx.db.simulatorState.iter())) {
    ctx.db.simulatorState.delete(simulator);
  }

  for (const market of Array.from(ctx.db.market.iter())) {
    ctx.db.market.delete(market);
  }

  seedSimulator(ctx);
});

export const tickMarkets = spacetimedb.reducer(
  { arg: marketTickScheduleRow },
  ctx => {
    // if (ctx.sender != ctx.identity) {
    //   throw new SenderError('tickMarkets reducer can only be called by the scheduler');
    // }

    const simulator = ctx.db.simulatorState.id.find(1);
    if (!simulator) {
      seedSimulator(ctx);
      return;
    }

    const now = ctx.timestamp;
    const currentMinuteStart = floorToMinute(now);
    const currentDayStart = floorToDay(now);
    let nextCandleId = simulator.nextCandleId;

    for (const state of Array.from(ctx.db.marketState.iter())) {
      const marketSeed = SEED_MARKETS_BY_ID.get(state.marketId);
      const snapshotRow = ctx.db.marketSnapshot.marketId.find(state.marketId);

      if (!marketSeed || !snapshotRow) {
        continue;
      }

      const quoteTick = buildQuoteTick(marketSeed, snapshotRow.price, state.seed, state.tick);
      const previousMinuteRow: CandleRow = {
        id: state.minuteCandleId,
        marketId: state.marketId,
        bucketStart: state.minuteBucketStart,
        open: state.minuteOpen,
        high: state.minuteHigh,
        low: state.minuteLow,
        close: state.minuteClose,
        volume: state.minuteVolume,
      };
      const previousDayRow: CandleRow = {
        id: state.dayCandleId,
        marketId: state.marketId,
        bucketStart: state.dayBucketStart,
        open: state.dayOpen,
        high: state.dayHigh,
        low: state.dayLow,
        close: state.dayClose,
        volume: state.dayVolume,
      };
      // const minuteRows = Array.from(
      //   ctx.db.marketMinuteCandle.marketId.filter(state.marketId)
      // );
      // const dayRows = Array.from(
      //   ctx.db.marketDayCandle.marketId.filter(state.marketId)
      // );
      const isSameMinuteBucket =
        previousMinuteRow.bucketStart.toMillis() === currentMinuteStart.toMillis();
      const isSameDayBucket = previousDayRow.bucketStart.toMillis() === currentDayStart.toMillis();

      let nextMinuteRow: CandleRow;
      // let updatedMinuteRows: CandleRow[];

      if (isSameMinuteBucket) {
        nextMinuteRow = {
          ...previousMinuteRow,
          high: Math.max(previousMinuteRow.high, quoteTick.price),
          low: Math.min(previousMinuteRow.low, quoteTick.price),
          close: quoteTick.price,
          volume: previousMinuteRow.volume + quoteTick.volume,
        };
        ctx.db.marketMinuteCandle.delete(previousMinuteRow);
        ctx.db.marketMinuteCandle.insert(nextMinuteRow);
        // updatedMinuteRows = minuteRows.map(row =>
        //   row.id === previousMinuteRow.id ? nextMinuteRow : row
        // );
      } else {
        nextMinuteRow = {
          id: nextCandleId,
          marketId: state.marketId,
          bucketStart: currentMinuteStart,
          open: quoteTick.price,
          high: quoteTick.price,
          low: quoteTick.price,
          close: quoteTick.price,
          volume: quoteTick.volume,
        };
        nextCandleId += 1n;
        ctx.db.marketMinuteCandle.insert(nextMinuteRow);
        // updatedMinuteRows = minuteRows.concat(nextMinuteRow);

        // while (updatedMinuteRows.length > MAX_MINUTE_CANDLES_PER_MARKET) {
        //   const oldestRow = updatedMinuteRows.shift();
        //   if (oldestRow) {
        //     ctx.db.marketMinuteCandle.delete(oldestRow);
        //   }
        // }
      }

      let nextDayRow: CandleRow;
      // let updatedDayRows: CandleRow[];

      if (isSameDayBucket) {
        nextDayRow = {
          ...previousDayRow,
          high: Math.max(previousDayRow.high, quoteTick.price),
          low: Math.min(previousDayRow.low, quoteTick.price),
          close: quoteTick.price,
          volume: previousDayRow.volume + quoteTick.volume,
        };
        ctx.db.marketDayCandle.delete(previousDayRow);
        ctx.db.marketDayCandle.insert(nextDayRow);
        // updatedDayRows = dayRows.map(row =>
        //   row.id === previousDayRow.id ? nextDayRow : row
        // );
      } else {
        nextDayRow = {
          id: nextCandleId,
          marketId: state.marketId,
          bucketStart: currentDayStart,
          open: quoteTick.price,
          high: quoteTick.price,
          low: quoteTick.price,
          close: quoteTick.price,
          volume: quoteTick.volume,
        };
        nextCandleId += 1n;
        ctx.db.marketDayCandle.insert(nextDayRow);
        // updatedDayRows = dayRows.concat(nextDayRow);

        // while (updatedDayRows.length > MAX_DAY_CANDLES_PER_MARKET) {
        //   const oldestRow = updatedDayRows.shift();
        //   if (oldestRow) {
        //     ctx.db.marketDayCandle.delete(oldestRow);
        //   }
        // }
      }

      ctx.db.marketSnapshot.delete(snapshotRow);
      ctx.db.marketSnapshot.insert(
        summarizeMarketSnapshot(ctx, marketSeed, now)
      );

      ctx.db.marketState.delete(state);
      ctx.db.marketState.insert({
        marketId: state.marketId,
        seed: quoteTick.seed,
        tick: state.tick + 1,
        minuteCandleId: nextMinuteRow.id,
        minuteBucketStart: nextMinuteRow.bucketStart,
        minuteOpen: nextMinuteRow.open,
        minuteHigh: nextMinuteRow.high,
        minuteLow: nextMinuteRow.low,
        minuteClose: nextMinuteRow.close,
        minuteVolume: nextMinuteRow.volume,
        dayCandleId: nextDayRow.id,
        dayBucketStart: nextDayRow.bucketStart,
        dayOpen: nextDayRow.open,
        dayHigh: nextDayRow.high,
        dayLow: nextDayRow.low,
        dayClose: nextDayRow.close,
        dayVolume: nextDayRow.volume,
      });
    }

    ctx.db.simulatorState.delete(simulator);
    ctx.db.simulatorState.insert({
      id: simulator.id,
      nextCandleId,
    });

  }
);

export const sayHello = spacetimedb.reducer(ctx => {
  ensureAuth0Jwt(ctx);
  for (const person of ctx.db.person.iter()) {
    console.info(`Hello, ${person.name}!`);
  }
  console.info('Hello, World!');
});

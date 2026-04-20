import { ScheduleAt } from 'spacetimedb';
import { schema, table, t, type ReducerCtx } from 'spacetimedb/server';

import {
  MINUTE_HISTORY_COUNT,
  MS_PER_MINUTE,
  QUOTE_INTERVAL_MS,
  RESET_SIMULATION_PERMISSION,
  SEED_MARKETS,
  SEED_MARKETS_BY_ID,
} from './simulator-config';
import type { CandleRow } from './simulator-config';
import { ensureAuth0Jwt, ensurePermission } from './simulator-auth';
import {
  buildOrderBookLevels,
  buildDayCandlesFromMinuteHistory,
  buildQuoteTick,
  buildSeedHistoryCandleBackward,
  floorToDay,
  floorToMinute,
  summarizeMarketSnapshot,
  timestampFromMillis,
} from './simulator-market';

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
  marketOrderBookLevel: table(
    { public: true, name: 'market_order_book_level' },
    {
      id: t.u64().primaryKey(),
      marketId: t.u32().index(),
      isBid: t.bool(),
      level: t.u8(),
      price: t.f64(),
      size: t.f64(),
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

export type ExchangeCtx = ReducerCtx<typeof spacetimedb.schemaType>;

function seedSimulator(ctx: ExchangeCtx) {
  if (
    ctx.db.market.count() > 0n ||
    ctx.db.marketSnapshot.count() > 0n ||
    ctx.db.marketOrderBookLevel.count() > 0n ||
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

    for (const level of buildOrderBookLevels(market, currentMinuteRow.close, minuteSeed, now)) {
      ctx.db.marketOrderBookLevel.insert(level);
    }
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
    ctx.db.marketOrderBookLevel.count() === 0n ||
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

  for (const level of Array.from(ctx.db.marketOrderBookLevel.iter())) {
    ctx.db.marketOrderBookLevel.delete(level);
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
      const nextOrderBookLevels = buildOrderBookLevels(
        marketSeed,
        quoteTick.price,
        quoteTick.seed,
        now
      );
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

      for (const existingLevel of Array.from(ctx.db.marketOrderBookLevel.marketId.filter(state.marketId))) {
        ctx.db.marketOrderBookLevel.delete(existingLevel);
      }
      for (const level of nextOrderBookLevels) {
        ctx.db.marketOrderBookLevel.insert(level);
      }

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

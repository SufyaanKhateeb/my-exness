import { ScheduleAt } from 'spacetimedb';

import {
  DEFAULT_ACCOUNT_BALANCE,
  isSyntheticMarketDataMode,
  MINUTE_HISTORY_COUNT,
  MS_PER_MINUTE,
  QUOTE_INTERVAL_MS,
  SEED_MARKETS,
  SEED_MARKETS_BY_ID,
} from './simulator-config';
import type { CandleRow } from './simulator-config';
import type { ExchangeCtx } from './module';
import { evaluatePriceAlertsForMarket, maybeFillOpenLimitOrders } from './trading-runtime';
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

function seedSimulator(ctx: ExchangeCtx) {
  if (!isSyntheticMarketDataMode()) {
    return;
  }

  if (
    ctx.db.market.count() > BigInt(0) ||
    ctx.db.marketSnapshot.count() > BigInt(0) ||
    ctx.db.marketOrderBookLevel.count() > BigInt(0) ||
    ctx.db.marketState.count() > BigInt(0) ||
    ctx.db.marketTickSchedule.count() > BigInt(0) ||
    ctx.db.simulatorState.count() > BigInt(0)
  ) {
    return;
  }

  const now = ctx.timestamp;
  const currentMinuteStart = floorToMinute(now);
  const currentDayStart = floorToDay(now);
  const currentMinuteStartMillis = Number(currentMinuteStart.toMillis());
  let nextCandleId = BigInt(1);

  for (const market of SEED_MARKETS) {
    let minuteSeed = BigInt(market.id) * BigInt(7919);
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
      nextCandleId += BigInt(1);
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
    scheduled_id: BigInt(0),
    scheduled_at: ScheduleAt.interval(BigInt(QUOTE_INTERVAL_MS) * BigInt(1000)),
    tickIntervalMs: QUOTE_INTERVAL_MS,
  });
}

function resetSimulationState(ctx: ExchangeCtx) {
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

  for (const order of Array.from(ctx.db.tradeOrder.iter())) {
    ctx.db.tradeOrder.delete(order);
  }

  for (const positionHistory of Array.from(ctx.db.positionHistory.iter())) {
    ctx.db.positionHistory.delete(positionHistory);
  }

  for (const position of Array.from(ctx.db.tradingPosition.iter())) {
    ctx.db.tradingPosition.delete(position);
  }

  for (const positionLot of Array.from(ctx.db.tradingPositionLot.iter())) {
    ctx.db.tradingPositionLot.delete(positionLot);
  }

  for (const account of Array.from(ctx.db.tradingAccount.iter())) {
    account.balance = DEFAULT_ACCOUNT_BALANCE;
    account.reservedBalance = 0;
    account.updatedAt = ctx.timestamp;
    ctx.db.tradingAccount.auth0UserId.update(account);
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

  if (isSyntheticMarketDataMode()) {
    seedSimulator(ctx);
  }
}

function tickAllMarkets(ctx: ExchangeCtx) {
  if (!isSyntheticMarketDataMode()) {
    return;
  }

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
    const isSameMinuteBucket =
      previousMinuteRow.bucketStart.toMillis() === currentMinuteStart.toMillis();
    const isSameDayBucket =
      previousDayRow.bucketStart.toMillis() === currentDayStart.toMillis();

    let nextMinuteRow: CandleRow;

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
      nextCandleId += BigInt(1);
      ctx.db.marketMinuteCandle.insert(nextMinuteRow);
    }

    let nextDayRow: CandleRow;

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
      nextCandleId += BigInt(1);
      ctx.db.marketDayCandle.insert(nextDayRow);
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

    evaluatePriceAlertsForMarket(ctx, state.marketId, now);

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

    maybeFillOpenLimitOrders(ctx, state.marketId, quoteTick.price, now);
  }

  ctx.db.simulatorState.delete(simulator);
  ctx.db.simulatorState.insert({
    id: simulator.id,
    nextCandleId,
  });
}

export { resetSimulationState, seedSimulator, tickAllMarkets };
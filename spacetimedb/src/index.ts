import { ScheduleAt } from 'spacetimedb';
import {
  SenderError,
  schema,
  table,
  t,
  type Infer,
  type ReducerCtx,
  type ViewCtx,
} from 'spacetimedb/server';

import {
  DEFAULT_ACCOUNT_BALANCE,
  DEFAULT_ACCOUNT_CURRENCY,
  MINUTE_HISTORY_COUNT,
  MS_PER_MINUTE,
  QUOTE_INTERVAL_MS,
  RESET_SIMULATION_PERMISSION,
  SEED_MARKETS,
  SEED_MARKETS_BY_ID,
} from './simulator-config';
import type { CandleRow } from './simulator-config';
import { ensureAuth0Jwt, ensurePermission, getCurrentAuth0UserId } from './simulator-auth';
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

const ORDER_SIDE_BUY = 'buy';
const ORDER_SIDE_SELL = 'sell';
const ORDER_TYPE_MARKET = 'market';
const ORDER_TYPE_LIMIT = 'limit';
const ORDER_STATUS_OPEN = 'open';
const ORDER_STATUS_FILLED = 'filled';
const ORDER_STATUS_CANCELLED = 'cancelled';
const POSITION_EPSILON = 1e-9;

const tradingAccountStateRow = t.row('TradingAccountState', {
  auth0UserId: t.string(),
  currency: t.string(),
  balance: t.f64(),
  reservedBalance: t.f64(),
  availableBalance: t.f64(),
  unrealizedPnl: t.f64(),
  netLiquidationValue: t.f64(),
  updatedAt: t.timestamp(),
});

const marketPositionStateRow = t.row('MarketPositionState', {
  marketId: t.u32(),
  quantity: t.f64(),
  reservedQuantity: t.f64(),
  availableQuantity: t.f64(),
  averageEntryPrice: t.f64(),
  markPrice: t.f64(),
  marketValue: t.f64(),
  unrealizedPnl: t.f64(),
  updatedAt: t.timestamp(),
});

const marketOrderStateRow = t.row('MarketOrderState', {
  id: t.u64(),
  marketId: t.u32(),
  side: t.string(),
  orderType: t.string(),
  status: t.string(),
  quantity: t.f64(),
  limitPrice: t.option(t.f64()),
  filledPrice: t.option(t.f64()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
  filledAt: t.option(t.timestamp()),
});

const userProfileRow = t.row('UserProfile', {
  auth0UserId: t.string().primaryKey(),
  senderIdentity: t.identity().unique(),
  displayName: t.string(),
  email: t.string(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const tradingAccountRow = t.row('TradingAccount', {
  auth0UserId: t.string().primaryKey(),
  currency: t.string(),
  balance: t.f64(),
  reservedBalance: t.f64(),
  updatedAt: t.timestamp(),
});

const tradingPositionRow = t.row('TradingPosition', {
  id: t.string().primaryKey(),
  auth0UserId: t.string().index(),
  marketId: t.u32().index(),
  quantity: t.f64(),
  reservedQuantity: t.f64(),
  averageEntryPrice: t.f64(),
  updatedAt: t.timestamp(),
});

const tradeOrderRow = t.row('TradeOrder', {
  id: t.u64().primaryKey().autoInc(),
  auth0UserId: t.string().index(),
  marketId: t.u32().index(),
  side: t.string(),
  orderType: t.string(),
  status: t.string().index(),
  quantity: t.f64(),
  limitPrice: t.option(t.f64()),
  filledPrice: t.option(t.f64()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
  filledAt: t.option(t.timestamp()),
});

const spacetimedb = schema({
  person: table(
    { public: true },
    {
      name: t.string(),
    }
  ),
  userProfile: table(
    {
      name: 'user_profile',
    },
    userProfileRow
  ),
  tradingAccount: table(
    {
      name: 'trading_account',
    },
    tradingAccountRow
  ),
  tradingPosition: table(
    {
      name: 'trading_position',
    },
    tradingPositionRow
  ),
  tradeOrder: table(
    {
      name: 'trade_order',
    },
    tradeOrderRow
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
type ExchangeViewCtx = ViewCtx<typeof spacetimedb.schemaType>;
type TradingReadCtx = { db: ExchangeCtx['db'] | ExchangeViewCtx['db'] };
type TradingAccountRowType = Infer<typeof tradingAccountRow>;
type TradingPositionRowType = Infer<typeof tradingPositionRow>;
type TradeOrderRowType = Infer<typeof tradeOrderRow>;

function normalizeQuantity(value: number) {
  return Math.abs(value) < POSITION_EPSILON ? 0 : value;
}

function requirePositiveQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new SenderError('Quantity must be greater than zero.');
  }
}

function requirePositivePrice(price: number) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new SenderError('Price must be greater than zero.');
  }
}

function getPositionId(auth0UserId: string, marketId: number) {
  return `${auth0UserId}:${marketId}`;
}

function getAvailableBalance(account: { balance: number; reservedBalance: number }) {
  return account.balance - account.reservedBalance;
}

function getAvailablePositionQuantity(position: { quantity: number; reservedQuantity: number } | null) {
  if (!position) {
    return 0;
  }

  return position.quantity - position.reservedQuantity;
}

function ensureTradingAccount(ctx: TradingReadCtx, auth0UserId: string) {
  const account = ctx.db.tradingAccount.auth0UserId.find(auth0UserId) as
    | TradingAccountRowType
    | undefined;

  if (!account) {
    throw new SenderError('Trading account not found. Sync the current user first.');
  }

  return account;
}

function ensureTradingResourceAccess(ctx: ExchangeCtx) {
  ensureAuth0Jwt(ctx);

  const auth0UserId = getCurrentAuth0UserId(ctx);
  const profile = ctx.db.userProfile.auth0UserId.find(auth0UserId);

  if (!profile) {
    throw new SenderError('User profile not found. Sync the current user first.');
  }

  return {
    auth0UserId,
    profile,
    account: ensureTradingAccount(ctx, auth0UserId),
  };
}

function getAuth0UserIdBySenderIdentity(
  ctx: TradingReadCtx,
  senderIdentity: ExchangeCtx['sender']
) {
  return ctx.db.userProfile.senderIdentity.find(senderIdentity)?.auth0UserId;
}

function ensureMarketSnapshot(ctx: ExchangeCtx, marketId: number) {
  const snapshot = ctx.db.marketSnapshot.marketId.find(marketId);

  if (!snapshot) {
    throw new SenderError('Market snapshot not found.');
  }

  return snapshot;
}

function computeTradingAccountState(ctx: TradingReadCtx, auth0UserId: string) {
  const account = ensureTradingAccount(ctx, auth0UserId);
  let unrealizedPnl = 0;
  let netLiquidationValue = account.balance;
  const positions = Array.from(
    ctx.db.tradingPosition.auth0UserId.filter(auth0UserId)
  ) as TradingPositionRowType[];

  for (const position of positions) {
    const snapshot = ctx.db.marketSnapshot.marketId.find(position.marketId);

    if (!snapshot) {
      continue;
    }

    const positionUnrealizedPnl = position.quantity * (snapshot.price - position.averageEntryPrice);
    unrealizedPnl += positionUnrealizedPnl;
    netLiquidationValue += position.quantity * snapshot.price;
  }

  return {
    auth0UserId,
    currency: account.currency,
    balance: account.balance,
    reservedBalance: account.reservedBalance,
    availableBalance: getAvailableBalance(account),
    unrealizedPnl,
    netLiquidationValue,
    updatedAt: account.updatedAt,
  };
}

function computeMarketPositionState(ctx: TradingReadCtx, auth0UserId: string, marketId: number) {
  const position = ctx.db.tradingPosition.id.find(getPositionId(auth0UserId, marketId));

  if (!position) {
    return undefined;
  }

  const snapshot = ctx.db.marketSnapshot.marketId.find(marketId);
  const markPrice = snapshot?.price ?? position.averageEntryPrice;
  const marketValue = position.quantity * markPrice;
  const unrealizedPnl = position.quantity * (markPrice - position.averageEntryPrice);

  return {
    marketId,
    quantity: position.quantity,
    reservedQuantity: position.reservedQuantity,
    availableQuantity: getAvailablePositionQuantity(position),
    averageEntryPrice: position.averageEntryPrice,
    markPrice,
    marketValue,
    unrealizedPnl,
    updatedAt: position.updatedAt,
  };
}

function listMarketPositionStateRows(ctx: TradingReadCtx, auth0UserId: string) {
  return (Array.from(ctx.db.tradingPosition.auth0UserId.filter(auth0UserId)) as TradingPositionRowType[])
    .map(position => computeMarketPositionState(ctx, auth0UserId, position.marketId))
    .filter(position => position !== undefined);
}

function listMarketOrderStateRows(ctx: TradingReadCtx, auth0UserId: string) {
  return (Array.from(ctx.db.tradeOrder.auth0UserId.filter(auth0UserId)) as TradeOrderRowType[])
    .sort((left, right) => Number(right.updatedAt.toMillis() - left.updatedAt.toMillis()))
    .map(order => ({
      id: order.id,
      marketId: order.marketId,
      side: order.side,
      orderType: order.orderType,
      status: order.status,
      quantity: order.quantity,
      limitPrice: order.limitPrice,
      filledPrice: order.filledPrice,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      filledAt: order.filledAt,
    }));
}

function executeAgainstOrderBook(
  ctx: ExchangeCtx,
  marketId: number,
  side: string,
  quantity: number,
  limitPrice: number | undefined,
  executedAt: ExchangeCtx['timestamp']
) {
  const opposingLevels = Array.from(ctx.db.marketOrderBookLevel.marketId.filter(marketId))
    .filter(level => side === ORDER_SIDE_BUY ? !level.isBid : level.isBid)
    .filter(level => {
      if (limitPrice == null) {
        return true;
      }

      return side === ORDER_SIDE_BUY
        ? level.price <= limitPrice + POSITION_EPSILON
        : level.price >= limitPrice - POSITION_EPSILON;
    })
    .sort((left, right) => {
      if (side === ORDER_SIDE_BUY) {
        return left.price === right.price ? left.level - right.level : left.price - right.price;
      }

      return left.price === right.price ? left.level - right.level : right.price - left.price;
    });

  let remainingQuantity = quantity;
  let totalNotional = 0;
  const fills: Array<{ level: typeof opposingLevels[number]; filledSize: number }> = [];

  for (const level of opposingLevels) {
    if (remainingQuantity <= POSITION_EPSILON) {
      break;
    }

    const filledSize = Math.min(remainingQuantity, level.size);

    if (filledSize <= POSITION_EPSILON) {
      continue;
    }

    fills.push({ level, filledSize });
    totalNotional += filledSize * level.price;
    remainingQuantity -= filledSize;
  }

  if (remainingQuantity > POSITION_EPSILON) {
    return null;
  }

  for (const fill of fills) {
    const nextSize = fill.level.size - fill.filledSize;

    if (nextSize <= POSITION_EPSILON) {
      ctx.db.marketOrderBookLevel.delete(fill.level);
      continue;
    }

    fill.level.size = nextSize;
    fill.level.updatedAt = executedAt;
    ctx.db.marketOrderBookLevel.id.update(fill.level);
  }

  return {
    averageFillPrice: totalNotional / quantity,
  };
}

function upsertTradingPosition(
  ctx: ExchangeCtx,
  auth0UserId: string,
  marketId: number,
  nextQuantity: number,
  reservedQuantity: number,
  averageEntryPrice: number,
  updatedAt: ExchangeCtx['timestamp']
) {
  const positionId = getPositionId(auth0UserId, marketId);
  const normalizedQuantity = normalizeQuantity(nextQuantity);
  const normalizedReservedQuantity = normalizeQuantity(reservedQuantity);
  const existingPosition = ctx.db.tradingPosition.id.find(positionId);

  if (normalizedQuantity === 0 && normalizedReservedQuantity === 0) {
    if (existingPosition) {
      ctx.db.tradingPosition.delete(existingPosition);
    }
    return null;
  }

  if (existingPosition) {
    existingPosition.quantity = normalizedQuantity;
    existingPosition.reservedQuantity = normalizedReservedQuantity;
    existingPosition.averageEntryPrice = normalizedQuantity === 0 ? 0 : averageEntryPrice;
    existingPosition.updatedAt = updatedAt;
    ctx.db.tradingPosition.id.update(existingPosition);
    return existingPosition;
  }

  return ctx.db.tradingPosition.insert({
    id: positionId,
    auth0UserId,
    marketId,
    quantity: normalizedQuantity,
    reservedQuantity: normalizedReservedQuantity,
    averageEntryPrice: normalizedQuantity === 0 ? 0 : averageEntryPrice,
    updatedAt,
  });
}

function fillTradeOrder(
  ctx: ExchangeCtx,
  orderId: bigint,
  fillPrice: number,
  filledAt: ExchangeCtx['timestamp']
) {
  const order = ctx.db.tradeOrder.id.find(orderId);

  if (!order) {
    return;
  }

  if (order.status !== ORDER_STATUS_OPEN) {
    return;
  }

  const account = ensureTradingAccount(ctx, order.auth0UserId);
  const notional = order.quantity * fillPrice;
  const positionId = getPositionId(order.auth0UserId, order.marketId);
  const existingPosition = ctx.db.tradingPosition.id.find(positionId);

  if (order.side === ORDER_SIDE_BUY) {
    const reservedNotional = order.orderType === ORDER_TYPE_LIMIT
      ? order.quantity * (order.limitPrice ?? fillPrice)
      : 0;

    if (order.orderType === ORDER_TYPE_MARKET && getAvailableBalance(account) + POSITION_EPSILON < notional) {
      throw new SenderError('Insufficient available balance for this market order.');
    }

    if (order.orderType === ORDER_TYPE_LIMIT && account.reservedBalance + POSITION_EPSILON < reservedNotional) {
      throw new SenderError('Reserved balance is insufficient to fill this limit order.');
    }

    account.balance -= notional;
    account.reservedBalance = Math.max(0, account.reservedBalance - reservedNotional);
    account.updatedAt = filledAt;
    ctx.db.tradingAccount.auth0UserId.update(account);

    const currentQuantity = existingPosition?.quantity ?? 0;
    const nextQuantity = currentQuantity + order.quantity;
    const currentCostBasis = currentQuantity * (existingPosition?.averageEntryPrice ?? 0);
    const nextAverageEntryPrice = nextQuantity > 0
      ? (currentCostBasis + notional) / nextQuantity
      : 0;

    upsertTradingPosition(
      ctx,
      order.auth0UserId,
      order.marketId,
      nextQuantity,
      existingPosition?.reservedQuantity ?? 0,
      nextAverageEntryPrice,
      filledAt
    );
  } else {
    if (!existingPosition || existingPosition.quantity + POSITION_EPSILON < order.quantity) {
      throw new SenderError('Insufficient position quantity for this sell order.');
    }

    if (order.orderType === ORDER_TYPE_LIMIT && existingPosition.reservedQuantity + POSITION_EPSILON < order.quantity) {
      throw new SenderError('Reserved position quantity is insufficient to fill this limit order.');
    }

    account.balance += notional;
    account.updatedAt = filledAt;
    ctx.db.tradingAccount.auth0UserId.update(account);

    const nextQuantity = existingPosition.quantity - order.quantity;
    const nextReservedQuantity = order.orderType === ORDER_TYPE_LIMIT
      ? existingPosition.reservedQuantity - order.quantity
      : existingPosition.reservedQuantity;

    upsertTradingPosition(
      ctx,
      order.auth0UserId,
      order.marketId,
      nextQuantity,
      nextReservedQuantity,
      nextQuantity > 0 ? existingPosition.averageEntryPrice : 0,
      filledAt
    );
  }

  order.status = ORDER_STATUS_FILLED;
  order.filledPrice = fillPrice;
  order.filledAt = filledAt;
  order.updatedAt = filledAt;
  ctx.db.tradeOrder.id.update(order);
}

function maybeFillOpenLimitOrders(ctx: ExchangeCtx, marketId: number, fillPrice: number, filledAt: ExchangeCtx['timestamp']) {
  const openOrders = Array.from(ctx.db.tradeOrder.marketId.filter(marketId))
    .filter(order => order.orderType === ORDER_TYPE_LIMIT && order.status === ORDER_STATUS_OPEN)
    .sort((left, right) => {
      const createdAtDiff = Number(left.createdAt.toMillis() - right.createdAt.toMillis());
      return createdAtDiff !== 0 ? createdAtDiff : Number(left.id - right.id);
    });

  for (const order of openOrders) {
    const limitPrice = order.limitPrice;

    if (limitPrice == null) {
      continue;
    }

    const execution = executeAgainstOrderBook(
      ctx,
      marketId,
      order.side,
      order.quantity,
      limitPrice,
      filledAt
    );

    if (execution) {
      fillTradeOrder(ctx, order.id, execution.averageFillPrice, filledAt);
    }
  }
}

function seedSimulator(ctx: ExchangeCtx) {
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

export const init = spacetimedb.init(ctx => {
  seedSimulator(ctx);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  if (
    ctx.db.market.count() === BigInt(0) ||
    ctx.db.marketSnapshot.count() === BigInt(0) ||
    ctx.db.marketOrderBookLevel.count() === BigInt(0) ||
    ctx.db.marketState.count() === BigInt(0) ||
    ctx.db.marketTickSchedule.count() === BigInt(0) ||
    ctx.db.simulatorState.count() === BigInt(0)
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

export const currentUserExists = spacetimedb.procedure(t.bool(), ctx => {
  return ctx.withTx(txCtx => {
    const auth0UserId = getCurrentAuth0UserId(txCtx);
    return Boolean(txCtx.db.userProfile.auth0UserId.find(auth0UserId));
  });
});

export const currentUserCanTrade = spacetimedb.procedure(t.bool(), ctx => {
  return ctx.withTx(txCtx => {
    try {
      ensureTradingResourceAccess(txCtx);
      return true;
    } catch {
      return false;
    }
  });
});

export const myTradingAccountState = spacetimedb.view(
  { name: 'my_trading_account_state', public: true },
  t.option(tradingAccountStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);

    if (!auth0UserId) {
      return undefined;
    }

    return computeTradingAccountState(ctx, auth0UserId);
  }
);

export const myMarketPositionState = spacetimedb.view(
  { name: 'my_market_position_state', public: true },
  t.array(marketPositionStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listMarketPositionStateRows(ctx, auth0UserId) : [];
  }
);

export const myMarketOrders = spacetimedb.view(
  { name: 'my_market_orders', public: true },
  t.array(marketOrderStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listMarketOrderStateRows(ctx, auth0UserId) : [];
  }
);

export const syncCurrentUser = spacetimedb.reducer(
  {
    displayName: t.string(),
    email: t.string(),
  },
  (ctx, { displayName, email }) => {
    const auth0UserId = getCurrentAuth0UserId(ctx);
    const now = ctx.timestamp;
    const normalizedDisplayName = displayName.trim() || auth0UserId;
    const normalizedEmail = email.trim();

    const existingProfile = ctx.db.userProfile.auth0UserId.find(auth0UserId);

    if (existingProfile) {
      existingProfile.senderIdentity = ctx.sender;
      existingProfile.displayName = normalizedDisplayName;
      existingProfile.email = normalizedEmail;
      existingProfile.updatedAt = now;
      ctx.db.userProfile.auth0UserId.update(existingProfile);
    } else {
      ctx.db.userProfile.insert({
        auth0UserId,
        senderIdentity: ctx.sender,
        displayName: normalizedDisplayName,
        email: normalizedEmail,
        createdAt: now,
        updatedAt: now,
      });
    }

    const existingAccount = ctx.db.tradingAccount.auth0UserId.find(auth0UserId);

    if (existingAccount) {
      existingAccount.updatedAt = now;
      ctx.db.tradingAccount.auth0UserId.update(existingAccount);

      return;
    }

    ctx.db.tradingAccount.insert({
      auth0UserId,
      currency: DEFAULT_ACCOUNT_CURRENCY,
      balance: DEFAULT_ACCOUNT_BALANCE,
      reservedBalance: 0,
      updatedAt: now,
    });
  }
);

export const placeMarketOrder = spacetimedb.reducer(
  {
    marketId: t.u32(),
    side: t.string(),
    quantity: t.f64(),
  },
  (ctx, { marketId, side, quantity }) => {
    const { auth0UserId, account } = ensureTradingResourceAccess(ctx);
    requirePositiveQuantity(quantity);
    ensureMarketSnapshot(ctx, marketId);

    if (side !== ORDER_SIDE_BUY && side !== ORDER_SIDE_SELL) {
      throw new SenderError('Unsupported order side.');
    }

    const now = ctx.timestamp;
    const position = ctx.db.tradingPosition.id.find(getPositionId(auth0UserId, marketId));
    const execution = executeAgainstOrderBook(ctx, marketId, side, quantity, undefined, now);

    if (!execution) {
      throw new SenderError('Insufficient order book size to execute this market order.');
    }

    const notional = quantity * execution.averageFillPrice;

    if (side === ORDER_SIDE_BUY && getAvailableBalance(account) + POSITION_EPSILON < notional) {
      throw new SenderError('Insufficient available balance.');
    }

    if (side === ORDER_SIDE_SELL && getAvailablePositionQuantity(position) + POSITION_EPSILON < quantity) {
      throw new SenderError('Insufficient available position quantity.');
    }

    const order = ctx.db.tradeOrder.insert({
      id: BigInt(0),
      auth0UserId,
      marketId,
      side,
      orderType: ORDER_TYPE_MARKET,
      status: ORDER_STATUS_OPEN,
      quantity,
      limitPrice: undefined,
      filledPrice: undefined,
      createdAt: now,
      updatedAt: now,
      filledAt: undefined,
    });

    fillTradeOrder(ctx, order.id, execution.averageFillPrice, now);
  }
);

export const placeLimitOrder = spacetimedb.reducer(
  {
    marketId: t.u32(),
    side: t.string(),
    quantity: t.f64(),
    limitPrice: t.f64(),
  },
  (ctx, { marketId, side, quantity, limitPrice }) => {
    const { auth0UserId, account } = ensureTradingResourceAccess(ctx);
    requirePositiveQuantity(quantity);
    requirePositivePrice(limitPrice);
    ensureMarketSnapshot(ctx, marketId);

    if (side !== ORDER_SIDE_BUY && side !== ORDER_SIDE_SELL) {
      throw new SenderError('Unsupported order side.');
    }

    const now = ctx.timestamp;
    const position = ctx.db.tradingPosition.id.find(getPositionId(auth0UserId, marketId));

    if (side === ORDER_SIDE_BUY) {
      const reserveAmount = quantity * limitPrice;

      if (getAvailableBalance(account) + POSITION_EPSILON < reserveAmount) {
        throw new SenderError('Insufficient available balance to place this limit order.');
      }

      account.reservedBalance += reserveAmount;
      account.updatedAt = now;
      ctx.db.tradingAccount.auth0UserId.update(account);
    } else {
      if (getAvailablePositionQuantity(position) + POSITION_EPSILON < quantity) {
        throw new SenderError('Insufficient available position quantity to place this limit order.');
      }

      if (!position) {
        throw new SenderError('No position is available for this sell limit order.');
      }

      position.reservedQuantity += quantity;
      position.updatedAt = now;
      ctx.db.tradingPosition.id.update(position);
    }

    const order = ctx.db.tradeOrder.insert({
      id: BigInt(0),
      auth0UserId,
      marketId,
      side,
      orderType: ORDER_TYPE_LIMIT,
      status: ORDER_STATUS_OPEN,
      quantity,
      limitPrice,
      filledPrice: undefined,
      createdAt: now,
      updatedAt: now,
      filledAt: undefined,
    });

    const execution = executeAgainstOrderBook(ctx, marketId, side, quantity, limitPrice, now);

    if (execution) {
      fillTradeOrder(ctx, order.id, execution.averageFillPrice, now);
    }
  }
);

export const cancelOrder = spacetimedb.reducer(
  { orderId: t.u64() },
  (ctx, { orderId }) => {
    const { auth0UserId } = ensureTradingResourceAccess(ctx);
    const order = ctx.db.tradeOrder.id.find(orderId);

    if (!order || order.auth0UserId !== auth0UserId) {
      throw new SenderError('Order not found.');
    }

    if (order.status !== ORDER_STATUS_OPEN) {
      throw new SenderError('Only open orders can be cancelled.');
    }

    const now = ctx.timestamp;

    if (order.orderType === ORDER_TYPE_LIMIT) {
      if (order.side === ORDER_SIDE_BUY) {
        const account = ensureTradingAccount(ctx, auth0UserId);
        account.reservedBalance = Math.max(0, account.reservedBalance - order.quantity * (order.limitPrice ?? 0));
        account.updatedAt = now;
        ctx.db.tradingAccount.auth0UserId.update(account);
      } else {
        const position = ctx.db.tradingPosition.id.find(getPositionId(auth0UserId, order.marketId));

        if (position) {
          position.reservedQuantity = Math.max(0, position.reservedQuantity - order.quantity);
          position.updatedAt = now;
          ctx.db.tradingPosition.id.update(position);
        }
      }
    }

    order.status = ORDER_STATUS_CANCELLED;
    order.updatedAt = now;
    ctx.db.tradeOrder.id.update(order);
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

  for (const order of Array.from(ctx.db.tradeOrder.iter())) {
    ctx.db.tradeOrder.delete(order);
  }

  for (const position of Array.from(ctx.db.tradingPosition.iter())) {
    ctx.db.tradingPosition.delete(position);
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
        nextCandleId += BigInt(1);
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
        nextCandleId += BigInt(1);
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

      maybeFillOpenLimitOrders(ctx, state.marketId, quoteTick.price, now);
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

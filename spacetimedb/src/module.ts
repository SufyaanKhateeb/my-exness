import {
  schema,
  table,
  t,
  type Infer,
  type ReducerCtx,
  type ViewCtx,
} from 'spacetimedb/server';

const ORDER_SIDE_BUY = 'buy';
const ORDER_SIDE_SELL = 'sell';
const ORDER_EXECUTION_TYPE_OPEN = 'open';
const ORDER_EXECUTION_TYPE_CLOSE = 'close';
const ORDER_TYPE_MARKET = 'market';
const ORDER_TYPE_LIMIT = 'limit';
const ORDER_STATUS_OPEN = 'open';
const ORDER_STATUS_FILLED = 'filled';
const ORDER_STATUS_CANCELLED = 'cancelled';
const PRICE_ALERT_STATUS_ACTIVE = 'active';
const PRICE_ALERT_STATUS_TRIGGERED = 'triggered';
const PRICE_ALERT_STATUS_CANCELLED = 'cancelled';
const PRICE_ALERT_STATUS_EXPIRED = 'expired';
const PRICE_ALERT_REFERENCE_BID = 'bid';
const PRICE_ALERT_REFERENCE_ASK = 'ask';
const PRICE_ALERT_DIRECTION_ABOVE = 'above';
const PRICE_ALERT_DIRECTION_BELOW = 'below';
const NOTIFICATION_LEVEL_INFO = 'info';
const NOTIFICATION_LEVEL_SUCCESS = 'success';
const NOTIFICATION_LEVEL_WARNING = 'warning';
const NOTIFICATION_KIND_ORDER_OPEN = 'order_open';
const NOTIFICATION_KIND_ORDER_FILLED = 'order_filled';
const NOTIFICATION_KIND_PRICE_ALERT_TRIGGERED = 'price_alert_triggered';
const NOTIFICATION_KIND_PRICE_ALERT_EXPIRED = 'price_alert_expired';
const POSITION_EPSILON = 1e-9;

const marketTickScheduleRow = t.row('MarketTickSchedule', {
  scheduled_id: t.u64().primaryKey().autoInc(),
  scheduled_at: t.scheduleAt(),
  tickIntervalMs: t.u32(),
});

let tickMarketsReducer: unknown;

function getTickMarketsReducer() {
  if (!tickMarketsReducer) {
    throw new Error('tickMarkets reducer has not been bound.');
  }

  return tickMarketsReducer;
}

function bindTickMarketsReducer(reducer: unknown) {
  tickMarketsReducer = reducer;
}

const marketTickSchedule = table(
  {
    name: 'market_tick_schedule',
    // SpacetimeDB schedule tables need a reducer export handle at registration time.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scheduled: (): any => getTickMarketsReducer(),
  },
  marketTickScheduleRow
);

const tradingAccountStateRow = t.row('TradingAccountState', {
  auth0UserId: t.string(),
  currency: t.string(),
  balance: t.f64(),
  equity: t.f64(),
  margin: t.f64(),
  freeMargin: t.f64(),
  marginLevel: t.f64(),
  accountLeverage: t.u16(),
  reservedBalance: t.f64(),
  availableBalance: t.f64(),
  unrealizedPnl: t.f64(),
  netLiquidationValue: t.f64(),
  updatedAt: t.timestamp(),
});

const marketPositionStateRow = t.row('MarketPositionState', {
  marketId: t.u32(),
  side: t.string(),
  quantity: t.f64(),
  reservedQuantity: t.f64(),
  availableQuantity: t.f64(),
  averageEntryPrice: t.f64(),
  markPrice: t.f64(),
  marketValue: t.f64(),
  unrealizedPnl: t.f64(),
  updatedAt: t.timestamp(),
});

const openPositionLotStateRow = t.row('OpenPositionLotState', {
  id: t.u64(),
  auth0UserId: t.string(),
  marketId: t.u32(),
  side: t.string(),
  quantity: t.f64(),
  openPrice: t.f64(),
  currentPrice: t.f64(),
  unrealizedPnl: t.f64(),
  openedAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const marketOrderStateRow = t.row('MarketOrderState', {
  id: t.u64(),
  marketId: t.u32(),
  side: t.string(),
  executionType: t.string(),
  orderType: t.string(),
  status: t.string(),
  quantity: t.f64(),
  limitPrice: t.option(t.f64()),
  filledPrice: t.option(t.f64()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
  filledAt: t.option(t.timestamp()),
});

const positionHistoryStateRow = t.row('PositionHistoryState', {
  id: t.u64(),
  orderId: t.u64(),
  auth0UserId: t.string(),
  marketId: t.u32(),
  quantity: t.f64(),
  entryPrice: t.f64(),
  exitPrice: t.f64(),
  realizedPnl: t.f64(),
  closedAt: t.timestamp(),
});

const priceAlertStateRow = t.row('PriceAlertState', {
  id: t.u64(),
  auth0UserId: t.string(),
  marketId: t.u32(),
  triggerPrice: t.f64(),
  referencePriceKind: t.string(),
  triggerDirection: t.string(),
  status: t.string(),
  expiresAt: t.timestamp(),
  triggeredAt: t.option(t.timestamp()),
  triggeredPrice: t.option(t.f64()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const notificationStateRow = t.row('NotificationState', {
  id: t.u64(),
  auth0UserId: t.string(),
  kind: t.string(),
  level: t.string(),
  title: t.string(),
  message: t.string(),
  marketId: t.option(t.u32()),
  seen: t.bool(),
  createdAt: t.timestamp(),
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
  accountLeverage: t.u16(),
  reservedBalance: t.f64(),
  updatedAt: t.timestamp(),
});

const tradingPositionRow = t.row('TradingPosition', {
  id: t.string().primaryKey(),
  auth0UserId: t.string().index(),
  marketId: t.u32().index(),
  side: t.string(),
  quantity: t.f64(),
  reservedQuantity: t.f64(),
  averageEntryPrice: t.f64(),
  updatedAt: t.timestamp(),
});

const tradingPositionLotRow = t.row('TradingPositionLot', {
  id: t.u64().primaryKey().autoInc(),
  auth0UserId: t.string().index(),
  marketId: t.u32().index(),
  side: t.string(),
  quantity: t.f64(),
  openPrice: t.f64(),
  openedAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const tradeOrderRow = t.row('TradeOrder', {
  id: t.u64().primaryKey().autoInc(),
  auth0UserId: t.string().index(),
  marketId: t.u32().index(),
  side: t.string(),
  executionType: t.string(),
  orderType: t.string(),
  status: t.string().index(),
  quantity: t.f64(),
  limitPrice: t.option(t.f64()),
  filledPrice: t.option(t.f64()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
  filledAt: t.option(t.timestamp()),
});

const positionHistoryRow = t.row('PositionHistory', {
  id: t.u64().primaryKey().autoInc(),
  orderId: t.u64().index(),
  auth0UserId: t.string().index(),
  marketId: t.u32().index(),
  quantity: t.f64(),
  entryPrice: t.f64(),
  exitPrice: t.f64(),
  realizedPnl: t.f64(),
  closedAt: t.timestamp(),
});

const priceAlertRow = t.row('PriceAlert', {
  id: t.u64().primaryKey().autoInc(),
  auth0UserId: t.string().index(),
  marketId: t.u32().index(),
  triggerPrice: t.f64(),
  referencePriceKind: t.string(),
  triggerDirection: t.string(),
  status: t.string().index(),
  expiresAt: t.timestamp(),
  triggeredAt: t.option(t.timestamp()),
  triggeredPrice: t.option(t.f64()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const notificationRow = t.row('Notification', {
  id: t.u64().primaryKey().autoInc(),
  auth0UserId: t.string().index(),
  kind: t.string(),
  level: t.string(),
  title: t.string(),
  message: t.string(),
  marketId: t.option(t.u32()),
  seen: t.bool(),
  createdAt: t.timestamp(),
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
  tradingPositionLot: table(
    {
      name: 'trading_position_lot',
    },
    tradingPositionLotRow
  ),
  tradeOrder: table(
    {
      name: 'trade_order',
    },
    tradeOrderRow
  ),
  positionHistory: table(
    {
      name: 'position_history',
    },
    positionHistoryRow
  ),
  priceAlert: table(
    {
      name: 'price_alert',
    },
    priceAlertRow
  ),
  notification: table(
    {
      name: 'notification',
    },
    notificationRow
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
      ],
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
      ],
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

type ExchangeCtx = ReducerCtx<typeof spacetimedb.schemaType>;
type ExchangeViewCtx = ViewCtx<typeof spacetimedb.schemaType>;
type TradingReadCtx = { db: ExchangeCtx['db'] | ExchangeViewCtx['db'] };
type NotificationRowType = Infer<typeof notificationRow>;
type OpenPositionLotRowType = Infer<typeof tradingPositionLotRow>;
type PriceAlertRowType = Infer<typeof priceAlertRow>;
type TradingAccountRowType = Infer<typeof tradingAccountRow>;
type TradingPositionRowType = Infer<typeof tradingPositionRow>;
type TradeOrderRowType = Infer<typeof tradeOrderRow>;

export default spacetimedb;
export {
  ORDER_EXECUTION_TYPE_CLOSE,
  ORDER_EXECUTION_TYPE_OPEN,
  NOTIFICATION_KIND_PRICE_ALERT_EXPIRED,
  NOTIFICATION_KIND_PRICE_ALERT_TRIGGERED,
  NOTIFICATION_KIND_ORDER_FILLED,
  NOTIFICATION_KIND_ORDER_OPEN,
  NOTIFICATION_LEVEL_INFO,
  NOTIFICATION_LEVEL_SUCCESS,
  NOTIFICATION_LEVEL_WARNING,
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_OPEN,
  ORDER_TYPE_LIMIT,
  ORDER_TYPE_MARKET,
  PRICE_ALERT_DIRECTION_ABOVE,
  PRICE_ALERT_DIRECTION_BELOW,
  PRICE_ALERT_REFERENCE_ASK,
  PRICE_ALERT_REFERENCE_BID,
  PRICE_ALERT_STATUS_ACTIVE,
  PRICE_ALERT_STATUS_CANCELLED,
  PRICE_ALERT_STATUS_EXPIRED,
  PRICE_ALERT_STATUS_TRIGGERED,
  POSITION_EPSILON,
  bindTickMarketsReducer,
  marketOrderStateRow,
  marketPositionStateRow,
  marketTickScheduleRow,
  notificationRow,
  notificationStateRow,
  openPositionLotStateRow,
  positionHistoryRow,
  positionHistoryStateRow,
  priceAlertRow,
  priceAlertStateRow,
  tradeOrderRow,
  tradingAccountRow,
  tradingAccountStateRow,
  tradingPositionLotRow,
  tradingPositionRow,
  userProfileRow,
};
export type {
  ExchangeCtx,
  ExchangeViewCtx,
  NotificationRowType,
  OpenPositionLotRowType,
  PriceAlertRowType,
  TradeOrderRowType,
  TradingAccountRowType,
  TradingPositionRowType,
  TradingReadCtx,
};

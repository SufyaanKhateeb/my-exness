import { SenderError, t } from 'spacetimedb/server';

import spacetimedb, {
  marketOrderStateRow,
  marketPositionStateRow,
  notificationStateRow,
  openPositionLotStateRow,
  ORDER_EXECUTION_TYPE_CLOSE,
  ORDER_EXECUTION_TYPE_OPEN,
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_OPEN,
  ORDER_TYPE_LIMIT,
  ORDER_TYPE_MARKET,
  PRICE_ALERT_STATUS_ACTIVE,
  positionHistoryStateRow,
  priceAlertStateRow,
  POSITION_EPSILON,
  tradingAccountStateRow,
} from './module';
import {
  DEFAULT_ACCOUNT_BALANCE,
  DEFAULT_ACCOUNT_LEVERAGE,
  DEFAULT_ACCOUNT_CURRENCY,
  MS_PER_DAY,
} from './simulator-config';
import { getCurrentAuth0UserId } from './simulator-auth';
import { timestampFromMillis } from './simulator-market';
import {
  computeTradingAccountState,
  evaluatePriceAlertsForMarket,
  ensureMarketSnapshot,
  ensureTradingAccount,
  ensureTradingResourceAccess,
  executeAgainstOrderBook,
  fillTradeOrder,
  getAuth0UserIdBySenderIdentity,
  getAvailablePositionQuantity,
  getOppositeOrderSide,
  getReferenceMarketPrice,
  getPositionId,
  inferPriceAlertDirection,
  listMarketOrderStateRows,
  listMarketPositionStateRows,
  listNotificationStateRows,
  listOpenPositionLotStateRows,
  listPositionHistoryStateRows,
  listPriceAlertStateRows,
  notifyOrderOpened,
  requireAllowedExecutionType,
  requireAllowedPriceAlertExpiryDays,
  requireAllowedPriceAlertReference,
  requirePositivePrice,
  requirePositiveQuantity,
} from './trading-runtime';

const currentUserExists = spacetimedb.procedure(t.bool(), ctx => {
  return ctx.withTx(txCtx => {
    const auth0UserId = getCurrentAuth0UserId(txCtx);
    return Boolean(txCtx.db.userProfile.auth0UserId.find(auth0UserId));
  });
});

const currentUserCanTrade = spacetimedb.procedure(t.bool(), ctx => {
  return ctx.withTx(txCtx => {
    try {
      ensureTradingResourceAccess(txCtx);
      return true;
    } catch {
      return false;
    }
  });
});

const ping = spacetimedb.procedure(t.string(), () => {
  return 'pong';
});

const myTradingAccountState = spacetimedb.view(
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

const myMarketPositionState = spacetimedb.view(
  { name: 'my_market_position_state', public: true },
  t.array(marketPositionStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listMarketPositionStateRows(ctx, auth0UserId) : [];
  }
);

const myOpenPositionLots = spacetimedb.view(
  { name: 'my_open_position_lots', public: true },
  t.array(openPositionLotStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listOpenPositionLotStateRows(ctx, auth0UserId) : [];
  }
);

const myMarketOrders = spacetimedb.view(
  { name: 'my_market_orders', public: true },
  t.array(marketOrderStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listMarketOrderStateRows(ctx, auth0UserId) : [];
  }
);

const myPositionHistory = spacetimedb.view(
  { name: 'my_position_history', public: true },
  t.array(positionHistoryStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listPositionHistoryStateRows(ctx, auth0UserId) : [];
  }
);

const myPriceAlerts = spacetimedb.view(
  { name: 'my_price_alerts', public: true },
  t.array(priceAlertStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listPriceAlertStateRows(ctx, auth0UserId) : [];
  }
);

const myNotifications = spacetimedb.view(
  { name: 'my_notifications', public: true },
  t.array(notificationStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listNotificationStateRows(ctx, auth0UserId) : [];
  }
);

const syncCurrentUser = spacetimedb.reducer(
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
      if (!existingAccount.accountLeverage || existingAccount.accountLeverage <= 0) {
        existingAccount.accountLeverage = DEFAULT_ACCOUNT_LEVERAGE;
      }
      existingAccount.updatedAt = now;
      ctx.db.tradingAccount.auth0UserId.update(existingAccount);
      return;
    }

    ctx.db.tradingAccount.insert({
      auth0UserId,
      currency: DEFAULT_ACCOUNT_CURRENCY,
      balance: DEFAULT_ACCOUNT_BALANCE,
      accountLeverage: DEFAULT_ACCOUNT_LEVERAGE,
      reservedBalance: 0,
      updatedAt: now,
    });
  }
);

const placeMarketOrder = spacetimedb.reducer(
  {
    marketId: t.u32(),
    side: t.string(),
    executionType: t.string(),
    quantity: t.f64(),
  },
  (ctx, { marketId, side, executionType, quantity }) => {
    const { auth0UserId } = ensureTradingResourceAccess(ctx);
    requirePositiveQuantity(quantity);
    requireAllowedExecutionType(executionType);
    ensureMarketSnapshot(ctx, marketId);

    if (side !== ORDER_SIDE_BUY && side !== ORDER_SIDE_SELL) {
      throw new SenderError('Unsupported order side.');
    }

    if (executionType !== ORDER_EXECUTION_TYPE_OPEN) {
      throw new SenderError('Use the dedicated close reducer for close orders.');
    }

    const now = ctx.timestamp;
    const execution = executeAgainstOrderBook(ctx, marketId, side, quantity, undefined, now);

    if (!execution) {
      throw new SenderError('Insufficient order book size to execute this market order.');
    }

    const order = ctx.db.tradeOrder.insert({
      id: BigInt(0),
      auth0UserId,
      marketId,
      side,
      executionType,
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

const placeLimitOrder = spacetimedb.reducer(
  {
    marketId: t.u32(),
    side: t.string(),
    executionType: t.string(),
    quantity: t.f64(),
    limitPrice: t.f64(),
  },
  (ctx, { marketId, side, executionType, quantity, limitPrice }) => {
    const { auth0UserId, account } = ensureTradingResourceAccess(ctx);
    requirePositiveQuantity(quantity);
    requirePositivePrice(limitPrice);
    requireAllowedExecutionType(executionType);
    ensureMarketSnapshot(ctx, marketId);

    if (side !== ORDER_SIDE_BUY && side !== ORDER_SIDE_SELL) {
      throw new SenderError('Unsupported order side.');
    }

    if (executionType !== ORDER_EXECUTION_TYPE_OPEN) {
      throw new SenderError('Use the dedicated close reducer for close orders.');
    }

    const now = ctx.timestamp;
    const accountLeverage = account.accountLeverage && account.accountLeverage > 0
      ? account.accountLeverage
      : DEFAULT_ACCOUNT_LEVERAGE;
    const reserveAmount = (quantity * limitPrice) / accountLeverage;

    if (computeTradingAccountState(ctx, auth0UserId).freeMargin + POSITION_EPSILON < reserveAmount) {
      throw new SenderError('Insufficient free margin to place this limit order.');
    }

    account.reservedBalance += reserveAmount;
    account.updatedAt = now;
    ctx.db.tradingAccount.auth0UserId.update(account);

    const order = ctx.db.tradeOrder.insert({
      id: BigInt(0),
      auth0UserId,
      marketId,
      side,
      executionType,
      orderType: ORDER_TYPE_LIMIT,
      status: ORDER_STATUS_OPEN,
      quantity,
      limitPrice,
      filledPrice: undefined,
      createdAt: now,
      updatedAt: now,
      filledAt: undefined,
    });

    notifyOrderOpened(ctx, order, now);

    const execution = executeAgainstOrderBook(ctx, marketId, side, quantity, limitPrice, now);

    if (execution) {
      fillTradeOrder(ctx, order.id, execution.averageFillPrice, now);
    }
  }
);

const closeMarketPosition = spacetimedb.reducer(
  {
    marketId: t.u32(),
    side: t.string(),
    quantity: t.f64(),
  },
  (ctx, { marketId, side, quantity }) => {
    const { auth0UserId } = ensureTradingResourceAccess(ctx);
    requirePositiveQuantity(quantity);
    ensureMarketSnapshot(ctx, marketId);

    if (side !== ORDER_SIDE_BUY && side !== ORDER_SIDE_SELL) {
      throw new SenderError('Unsupported order side.');
    }

    const now = ctx.timestamp;
    const position = ctx.db.tradingPosition.id.find(getPositionId(auth0UserId, marketId, side));

    if (!position || getAvailablePositionQuantity(position) + POSITION_EPSILON < quantity) {
      throw new SenderError('Insufficient available position quantity to close.');
    }

    const closeOrderSide = getOppositeOrderSide(side);
    const execution = executeAgainstOrderBook(ctx, marketId, closeOrderSide, quantity, undefined, now);

    if (!execution) {
      throw new SenderError('Insufficient order book size to close this position.');
    }

    const order = ctx.db.tradeOrder.insert({
      id: BigInt(0),
      auth0UserId,
      marketId,
      side: closeOrderSide,
      executionType: ORDER_EXECUTION_TYPE_CLOSE,
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

const cancelOrder = spacetimedb.reducer(
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
      if (order.executionType === ORDER_EXECUTION_TYPE_OPEN) {
        const account = ensureTradingAccount(ctx, auth0UserId);
        const accountLeverage = account.accountLeverage && account.accountLeverage > 0
          ? account.accountLeverage
          : DEFAULT_ACCOUNT_LEVERAGE;
        account.reservedBalance = Math.max(
          0,
          account.reservedBalance - ((order.quantity * (order.limitPrice ?? 0)) / accountLeverage)
        );
        account.updatedAt = now;
        ctx.db.tradingAccount.auth0UserId.update(account);
      } else {
        const position = ctx.db.tradingPosition.id.find(
          getPositionId(auth0UserId, order.marketId, getOppositeOrderSide(order.side))
        );

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

const createPriceAlert = spacetimedb.reducer(
  {
    marketId: t.u32(),
    triggerPrice: t.f64(),
    referencePriceKind: t.string(),
    expiryDays: t.u16(),
  },
  (ctx, { marketId, triggerPrice, referencePriceKind, expiryDays }) => {
    const { auth0UserId } = ensureTradingResourceAccess(ctx);
    requirePositivePrice(triggerPrice);
    requireAllowedPriceAlertReference(referencePriceKind);
    requireAllowedPriceAlertExpiryDays(expiryDays);
    ensureMarketSnapshot(ctx, marketId);

    const now = ctx.timestamp;
    const currentReferencePrice = getReferenceMarketPrice(ctx, marketId, referencePriceKind);
    const triggerDirection = inferPriceAlertDirection(currentReferencePrice, triggerPrice);
    const expiresAt = timestampFromMillis(Number(now.toMillis()) + Number(expiryDays) * MS_PER_DAY);

    ctx.db.priceAlert.insert({
      id: BigInt(0),
      auth0UserId,
      marketId,
      triggerPrice,
      referencePriceKind,
      triggerDirection,
      status: PRICE_ALERT_STATUS_ACTIVE,
      expiresAt,
      triggeredAt: undefined,
      triggeredPrice: undefined,
      createdAt: now,
      updatedAt: now,
    });

    evaluatePriceAlertsForMarket(ctx, marketId, now);
  }
);

const deletePriceAlert = spacetimedb.reducer(
  { alertId: t.u64() },
  (ctx, { alertId }) => {
    const { auth0UserId } = ensureTradingResourceAccess(ctx);
    const alert = ctx.db.priceAlert.id.find(alertId);

    if (!alert || alert.auth0UserId !== auth0UserId) {
      throw new SenderError('Price alert not found.');
    }

    ctx.db.priceAlert.delete(alert);
  }
);

const deleteNotification = spacetimedb.reducer(
  { notificationId: t.u64() },
  (ctx, { notificationId }) => {
    const { auth0UserId } = ensureTradingResourceAccess(ctx);
    const notification = ctx.db.notification.id.find(notificationId);

    if (!notification || notification.auth0UserId !== auth0UserId) {
      throw new SenderError('Notification not found.');
    }

    ctx.db.notification.delete(notification);
  }
);

const markNotificationSeen = spacetimedb.reducer(
  { notificationId: t.u64() },
  (ctx, { notificationId }) => {
    const { auth0UserId } = ensureTradingResourceAccess(ctx);
    const notification = ctx.db.notification.id.find(notificationId);

    if (!notification || notification.auth0UserId !== auth0UserId) {
      throw new SenderError('Notification not found.');
    }

    notification.seen = true;
    ctx.db.notification.id.update(notification);
  }
);

export {
  cancelOrder,
  closeMarketPosition,
  createPriceAlert,
  currentUserCanTrade,
  currentUserExists,
  deleteNotification,
  deletePriceAlert,
  markNotificationSeen,
  myMarketOrders,
  myMarketPositionState,
  myNotifications,
  myOpenPositionLots,
  myPositionHistory,
  myPriceAlerts,
  myTradingAccountState,
  ping,
  placeLimitOrder,
  placeMarketOrder,
  syncCurrentUser,
};

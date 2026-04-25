import { SenderError } from 'spacetimedb/server';

import {
  ORDER_EXECUTION_TYPE_CLOSE,
  ORDER_EXECUTION_TYPE_OPEN,
  NOTIFICATION_KIND_PRICE_ALERT_EXPIRED,
  NOTIFICATION_KIND_PRICE_ALERT_TRIGGERED,
  NOTIFICATION_LEVEL_INFO,
  NOTIFICATION_LEVEL_SUCCESS,
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
  PRICE_ALERT_STATUS_EXPIRED,
  PRICE_ALERT_STATUS_TRIGGERED,
  POSITION_EPSILON,
  type ExchangeCtx,
  type NotificationRowType,
  type OpenPositionLotRowType,
  type PriceAlertRowType,
  type TradingAccountRowType,
  type TradeOrderRowType,
  type TradingPositionRowType,
  type TradingReadCtx,
} from './module';
import { DEFAULT_ACCOUNT_LEVERAGE } from './simulator-config';
import { ensureAuth0Jwt, getCurrentAuth0UserId } from './simulator-auth';

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

function requireAllowedExecutionType(executionType: string) {
  if (
    executionType !== ORDER_EXECUTION_TYPE_OPEN &&
    executionType !== ORDER_EXECUTION_TYPE_CLOSE
  ) {
    throw new SenderError('Order execution type must be either open or close.');
  }
}

function requireAllowedPriceAlertReference(referencePriceKind: string) {
  if (
    referencePriceKind !== PRICE_ALERT_REFERENCE_BID &&
    referencePriceKind !== PRICE_ALERT_REFERENCE_ASK
  ) {
    throw new SenderError('Price alerts must target either the bid or ask price.');
  }
}

function requireAllowedPriceAlertExpiryDays(expiryDays: number) {
  if (![1, 5, 15, 30].includes(expiryDays)) {
    throw new SenderError('Price alert expiry must be 1, 5, 15, or 30 days.');
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

  return Math.max(0, Math.abs(position.quantity) - position.reservedQuantity);
}

function getPositionSideFromQuantity(quantity: number) {
  return quantity >= 0 ? ORDER_SIDE_BUY : ORDER_SIDE_SELL;
}

function getRequiredMargin(notional: number, accountLeverage: number) {
  const normalizedLeverage = accountLeverage > 0 ? accountLeverage : DEFAULT_ACCOUNT_LEVERAGE;
  return notional / normalizedLeverage;
}

function getOrderReservedMargin(
  order: Pick<TradeOrderRowType, 'quantity' | 'limitPrice'>,
  accountLeverage: number,
  fallbackPrice?: number
) {
  const referencePrice = order.limitPrice ?? fallbackPrice;

  if (referencePrice == null) {
    return 0;
  }

  return getRequiredMargin(order.quantity * referencePrice, accountLeverage);
}

function computeLotUnrealizedPnl(side: string, quantity: number, entryPrice: number, currentPrice: number) {
  return side === ORDER_SIDE_BUY
    ? quantity * (currentPrice - entryPrice)
    : quantity * (entryPrice - currentPrice);
}

function computeLotRealizedPnl(side: string, quantity: number, entryPrice: number, exitPrice: number) {
  return side === ORDER_SIDE_BUY
    ? quantity * (exitPrice - entryPrice)
    : quantity * (entryPrice - exitPrice);
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

function getBestBidAsk(ctx: TradingReadCtx, marketId: number) {
  const levels = Array.from(ctx.db.marketOrderBookLevel.marketId.filter(marketId));
  const bidLevels = levels.filter(level => level.isBid).sort((left, right) => right.price - left.price);
  const askLevels = levels.filter(level => !level.isBid).sort((left, right) => left.price - right.price);
  const snapshot = ctx.db.marketSnapshot.marketId.find(marketId);

  return {
    bestBid: bidLevels[0]?.price ?? snapshot?.price,
    bestAsk: askLevels[0]?.price ?? snapshot?.price,
  };
}

function getReferenceMarketPrice(
  ctx: TradingReadCtx,
  marketId: number,
  referencePriceKind: string
) {
  requireAllowedPriceAlertReference(referencePriceKind);
  const { bestBid, bestAsk } = getBestBidAsk(ctx, marketId);
  const referencePrice = referencePriceKind === PRICE_ALERT_REFERENCE_BID ? bestBid : bestAsk;

  if (referencePrice == null || !Number.isFinite(referencePrice)) {
    throw new SenderError('Reference market price is unavailable for this alert.');
  }

  return referencePrice;
}

function inferPriceAlertDirection(currentPrice: number, triggerPrice: number) {
  return triggerPrice >= currentPrice ? PRICE_ALERT_DIRECTION_ABOVE : PRICE_ALERT_DIRECTION_BELOW;
}

function doesPriceAlertTrigger(
  alert: { triggerPrice: number; triggerDirection: string },
  currentPrice: number
) {
  if (alert.triggerDirection === PRICE_ALERT_DIRECTION_ABOVE) {
    return currentPrice + POSITION_EPSILON >= alert.triggerPrice;
  }

  if (alert.triggerDirection === PRICE_ALERT_DIRECTION_BELOW) {
    return currentPrice - POSITION_EPSILON <= alert.triggerPrice;
  }

  throw new SenderError('Price alert direction is invalid.');
}

function createNotification(
  ctx: ExchangeCtx,
  input: {
    auth0UserId: string;
    kind: string;
    level: string;
    title: string;
    message: string;
    marketId?: number;
    createdAt: ExchangeCtx['timestamp'];
  }
) {
  ctx.db.notification.insert({
    id: BigInt(0),
    auth0UserId: input.auth0UserId,
    kind: input.kind,
    level: input.level,
    title: input.title,
    message: input.message,
    marketId: input.marketId,
    createdAt: input.createdAt,
  });
}

function listNotificationStateRows(ctx: TradingReadCtx, auth0UserId: string) {
  return (Array.from(ctx.db.notification.auth0UserId.filter(auth0UserId)) as NotificationRowType[])
    .sort((left, right) => Number(left.createdAt.toMillis() - right.createdAt.toMillis()))
    .map(notification => ({
      id: notification.id,
      auth0UserId: notification.auth0UserId,
      kind: notification.kind,
      level: notification.level,
      title: notification.title,
      message: notification.message,
      marketId: notification.marketId,
      createdAt: notification.createdAt,
    }));
}

function computeTradingAccountState(ctx: TradingReadCtx, auth0UserId: string) {
  const account = ensureTradingAccount(ctx, auth0UserId);
  let unrealizedPnl = 0;
  let margin = 0;
  const positions = Array.from(
    ctx.db.tradingPosition.auth0UserId.filter(auth0UserId)
  ) as TradingPositionRowType[];
  const accountLeverage =
    account.accountLeverage && account.accountLeverage > 0
      ? account.accountLeverage
      : DEFAULT_ACCOUNT_LEVERAGE;

  for (const position of positions) {
    const snapshot = ctx.db.marketSnapshot.marketId.find(position.marketId);

    if (!snapshot) {
      continue;
    }

    const positionMarketValue = Math.abs(position.quantity) * snapshot.price;
    const positionUnrealizedPnl = position.quantity * (snapshot.price - position.averageEntryPrice);

    unrealizedPnl += positionUnrealizedPnl;
    margin += positionMarketValue / accountLeverage;
  }

  const balance = account.balance;
  const equity = account.balance + unrealizedPnl;
  const freeMargin = equity - margin - account.reservedBalance;
  const marginLevel = margin > POSITION_EPSILON ? (equity / margin) * 100 : 0;

  return {
    auth0UserId,
    currency: account.currency,
    balance,
    equity,
    margin,
    freeMargin,
    marginLevel,
    accountLeverage,
    reservedBalance: account.reservedBalance,
    availableBalance: freeMargin,
    unrealizedPnl,
    netLiquidationValue: equity,
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
  const marketValue = Math.abs(position.quantity) * markPrice;
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

function listOpenPositionLotStateRows(ctx: TradingReadCtx, auth0UserId: string) {
  return (Array.from(ctx.db.tradingPositionLot.auth0UserId.filter(auth0UserId)) as OpenPositionLotRowType[])
    .sort((left, right) => {
      const openedAtDiff = Number(right.openedAt.toMillis() - left.openedAt.toMillis());
      return openedAtDiff !== 0 ? openedAtDiff : Number(right.id - left.id);
    })
    .map(lot => {
      const snapshot = ctx.db.marketSnapshot.marketId.find(lot.marketId);
      const currentPrice = snapshot?.price ?? lot.openPrice;

      return {
        id: lot.id,
        auth0UserId: lot.auth0UserId,
        marketId: lot.marketId,
        side: lot.side,
        quantity: lot.quantity,
        openPrice: lot.openPrice,
        currentPrice,
        unrealizedPnl: computeLotUnrealizedPnl(lot.side, lot.quantity, lot.openPrice, currentPrice),
        openedAt: lot.openedAt,
        updatedAt: lot.updatedAt,
      };
    });
}

function listMarketOrderStateRows(ctx: TradingReadCtx, auth0UserId: string) {
  return (Array.from(ctx.db.tradeOrder.auth0UserId.filter(auth0UserId)) as TradeOrderRowType[])
    .sort((left, right) => Number(right.updatedAt.toMillis() - left.updatedAt.toMillis()))
    .map(order => ({
      id: order.id,
      marketId: order.marketId,
      side: order.side,
      executionType: order.executionType,
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

function listPositionHistoryStateRows(ctx: TradingReadCtx, auth0UserId: string) {
  return Array.from(ctx.db.positionHistory.auth0UserId.filter(auth0UserId))
    .sort((left, right) => Number(right.closedAt.toMillis() - left.closedAt.toMillis()))
    .map(positionHistory => ({
      id: positionHistory.id,
      orderId: positionHistory.orderId,
      auth0UserId: positionHistory.auth0UserId,
      marketId: positionHistory.marketId,
      quantity: positionHistory.quantity,
      entryPrice: positionHistory.entryPrice,
      exitPrice: positionHistory.exitPrice,
      realizedPnl: positionHistory.realizedPnl,
      closedAt: positionHistory.closedAt,
    }));
}

function listPriceAlertStateRows(ctx: TradingReadCtx, auth0UserId: string) {
  return (Array.from(ctx.db.priceAlert.auth0UserId.filter(auth0UserId)) as PriceAlertRowType[])
    .sort((left, right) => Number(right.updatedAt.toMillis() - left.updatedAt.toMillis()))
    .map(alert => ({
      id: alert.id,
      auth0UserId: alert.auth0UserId,
      marketId: alert.marketId,
      triggerPrice: alert.triggerPrice,
      referencePriceKind: alert.referencePriceKind,
      triggerDirection: alert.triggerDirection,
      status: alert.status,
      expiresAt: alert.expiresAt,
      triggeredAt: alert.triggeredAt,
      triggeredPrice: alert.triggeredPrice,
      createdAt: alert.createdAt,
      updatedAt: alert.updatedAt,
    }));
}

function evaluatePriceAlertsForMarket(
  ctx: ExchangeCtx,
  marketId: number,
  evaluatedAt: ExchangeCtx['timestamp']
) {
  const market = ctx.db.market.id.find(marketId);
  const marketSymbol = market?.symbol ?? `Market #${marketId}`;

  for (const alert of Array.from(ctx.db.priceAlert.marketId.filter(marketId)) as PriceAlertRowType[]) {
    if (alert.status !== PRICE_ALERT_STATUS_ACTIVE) {
      continue;
    }

    if (alert.expiresAt.toMillis() <= evaluatedAt.toMillis()) {
      alert.status = PRICE_ALERT_STATUS_EXPIRED;
      alert.updatedAt = evaluatedAt;
      ctx.db.priceAlert.id.update(alert);
      createNotification(ctx, {
        auth0UserId: alert.auth0UserId,
        kind: NOTIFICATION_KIND_PRICE_ALERT_EXPIRED,
        level: NOTIFICATION_LEVEL_INFO,
        title: 'Price alert expired',
        message: `${marketSymbol} ${alert.referencePriceKind} alert at ${alert.triggerPrice} expired before triggering.`,
        marketId,
        createdAt: evaluatedAt,
      });
      continue;
    }

    const referencePrice = getReferenceMarketPrice(ctx, marketId, alert.referencePriceKind);

    if (!doesPriceAlertTrigger(alert, referencePrice)) {
      continue;
    }

    alert.status = PRICE_ALERT_STATUS_TRIGGERED;
    alert.triggeredAt = evaluatedAt;
    alert.triggeredPrice = referencePrice;
    alert.updatedAt = evaluatedAt;
    ctx.db.priceAlert.id.update(alert);
    createNotification(ctx, {
      auth0UserId: alert.auth0UserId,
      kind: NOTIFICATION_KIND_PRICE_ALERT_TRIGGERED,
      level: NOTIFICATION_LEVEL_SUCCESS,
      title: 'Price alert triggered',
      message: `${marketSymbol} ${alert.referencePriceKind} reached ${referencePrice} against your alert at ${alert.triggerPrice}.`,
      marketId,
      createdAt: evaluatedAt,
    });
  }
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

function consumePositionLots(
  ctx: ExchangeCtx,
  auth0UserId: string,
  marketId: number,
  openingSide: string,
  quantityToClose: number,
  exitPrice: number,
  orderId: bigint,
  closedAt: ExchangeCtx['timestamp']
) {
  let remainingQuantity = quantityToClose;
  const lots = Array.from(ctx.db.tradingPositionLot.auth0UserId.filter(auth0UserId))
    .filter(lot => lot.marketId === marketId && lot.side === openingSide)
    .sort((left, right) => {
      const openedAtDiff = Number(left.openedAt.toMillis() - right.openedAt.toMillis());
      return openedAtDiff !== 0 ? openedAtDiff : Number(left.id - right.id);
    }) as OpenPositionLotRowType[];
  let realizedPnl = 0;

  for (const lot of lots) {
    if (remainingQuantity <= POSITION_EPSILON) {
      break;
    }

    const closedQuantity = Math.min(remainingQuantity, lot.quantity);

    if (closedQuantity <= POSITION_EPSILON) {
      continue;
    }

    ctx.db.positionHistory.insert({
      id: BigInt(0),
      orderId,
      auth0UserId,
      marketId,
      quantity: closedQuantity,
      entryPrice: lot.openPrice,
      exitPrice,
      realizedPnl: computeLotRealizedPnl(openingSide, closedQuantity, lot.openPrice, exitPrice),
      closedAt,
    });

    realizedPnl += computeLotRealizedPnl(openingSide, closedQuantity, lot.openPrice, exitPrice);

    remainingQuantity -= closedQuantity;
    const nextQuantity = lot.quantity - closedQuantity;

    if (nextQuantity <= POSITION_EPSILON) {
      ctx.db.tradingPositionLot.delete(lot);
      continue;
    }

    lot.quantity = nextQuantity;
    lot.updatedAt = closedAt;
    ctx.db.tradingPositionLot.id.update(lot);
  }

  if (remainingQuantity > POSITION_EPSILON) {
    throw new SenderError('Open position lots are inconsistent with aggregate position quantity.');
  }

  return realizedPnl;
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
  const accountLeverage = account.accountLeverage > 0 ? account.accountLeverage : DEFAULT_ACCOUNT_LEVERAGE;

  if (order.executionType === ORDER_EXECUTION_TYPE_OPEN) {
    const existingPositionSide = existingPosition && Math.abs(existingPosition.quantity) > POSITION_EPSILON
      ? getPositionSideFromQuantity(existingPosition.quantity)
      : undefined;

    if (existingPositionSide && existingPositionSide !== order.side) {
      throw new SenderError('Close the current position before opening the opposite side.');
    }

    const requiredMargin = getRequiredMargin(notional, accountLeverage);
    const reservedMargin = order.orderType === ORDER_TYPE_LIMIT
      ? getOrderReservedMargin(order, accountLeverage, fillPrice)
      : 0;

    if (order.orderType === ORDER_TYPE_MARKET) {
      const accountState = computeTradingAccountState(ctx, order.auth0UserId);

      if (accountState.freeMargin + POSITION_EPSILON < requiredMargin) {
        throw new SenderError('Insufficient free margin for this market order.');
      }
    }

    if (order.orderType === ORDER_TYPE_LIMIT) {
      if (account.reservedBalance + POSITION_EPSILON < reservedMargin) {
        throw new SenderError('Reserved margin is insufficient to fill this limit order.');
      }

      account.reservedBalance = Math.max(0, account.reservedBalance - reservedMargin);
      account.updatedAt = filledAt;
      ctx.db.tradingAccount.auth0UserId.update(account);
    }

    const currentAbsoluteQuantity = Math.abs(existingPosition?.quantity ?? 0);
    const nextAbsoluteQuantity = currentAbsoluteQuantity + order.quantity;
    const currentCostBasis = currentAbsoluteQuantity * (existingPosition?.averageEntryPrice ?? 0);
    const nextAverageEntryPrice = nextAbsoluteQuantity > 0
      ? (currentCostBasis + notional) / nextAbsoluteQuantity
      : 0;
    const nextQuantity = order.side === ORDER_SIDE_BUY ? nextAbsoluteQuantity : -nextAbsoluteQuantity;

    upsertTradingPosition(
      ctx,
      order.auth0UserId,
      order.marketId,
      nextQuantity,
      existingPosition?.reservedQuantity ?? 0,
      nextAverageEntryPrice,
      filledAt
    );

    ctx.db.tradingPositionLot.insert({
      id: BigInt(0),
      auth0UserId: order.auth0UserId,
      marketId: order.marketId,
      side: order.side,
      quantity: order.quantity,
      openPrice: fillPrice,
      openedAt: filledAt,
      updatedAt: filledAt,
    });
  } else {
    if (!existingPosition || Math.abs(existingPosition.quantity) + POSITION_EPSILON < order.quantity) {
      throw new SenderError('Insufficient position quantity for this close order.');
    }

    const openingSide = getPositionSideFromQuantity(existingPosition.quantity);
    const expectedCloseSide = openingSide === ORDER_SIDE_BUY ? ORDER_SIDE_SELL : ORDER_SIDE_BUY;

    if (order.side !== expectedCloseSide) {
      throw new SenderError('Close orders must use the opposite side of the open position.');
    }

    if (order.orderType === ORDER_TYPE_LIMIT && existingPosition.reservedQuantity + POSITION_EPSILON < order.quantity) {
      throw new SenderError('Reserved position quantity is insufficient to fill this limit order.');
    }

    const realizedPnl = consumePositionLots(
      ctx,
      order.auth0UserId,
      order.marketId,
      openingSide,
      order.quantity,
      fillPrice,
      order.id,
      filledAt
    );

    account.balance += realizedPnl;
    account.updatedAt = filledAt;
    ctx.db.tradingAccount.auth0UserId.update(account);

    const nextAbsoluteQuantity = Math.max(0, Math.abs(existingPosition.quantity) - order.quantity);
    const nextReservedQuantity = order.orderType === ORDER_TYPE_LIMIT
      ? Math.max(0, existingPosition.reservedQuantity - order.quantity)
      : existingPosition.reservedQuantity;
    const nextQuantity = nextAbsoluteQuantity === 0
      ? 0
      : openingSide === ORDER_SIDE_BUY
        ? nextAbsoluteQuantity
        : -nextAbsoluteQuantity;

    upsertTradingPosition(
      ctx,
      order.auth0UserId,
      order.marketId,
      nextQuantity,
      nextReservedQuantity,
      nextAbsoluteQuantity > 0 ? existingPosition.averageEntryPrice : 0,
      filledAt
    );
  }

  order.status = ORDER_STATUS_FILLED;
  order.filledPrice = fillPrice;
  order.filledAt = filledAt;
  order.updatedAt = filledAt;
  ctx.db.tradeOrder.id.update(order);
}

function maybeFillOpenLimitOrders(
  ctx: ExchangeCtx,
  marketId: number,
  fillPrice: number,
  filledAt: ExchangeCtx['timestamp']
) {
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

export {
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  ORDER_EXECUTION_TYPE_CLOSE,
  ORDER_EXECUTION_TYPE_OPEN,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_OPEN,
  ORDER_TYPE_LIMIT,
  ORDER_TYPE_MARKET,
  POSITION_EPSILON,
  computeMarketPositionState,
  computeTradingAccountState,
  doesPriceAlertTrigger,
  evaluatePriceAlertsForMarket,
  ensureMarketSnapshot,
  ensureTradingAccount,
  ensureTradingResourceAccess,
  executeAgainstOrderBook,
  fillTradeOrder,
  getAuth0UserIdBySenderIdentity,
  getAvailableBalance,
  getAvailablePositionQuantity,
  getReferenceMarketPrice,
  getPositionId,
  inferPriceAlertDirection,
  listMarketOrderStateRows,
  listMarketPositionStateRows,
  listOpenPositionLotStateRows,
  listNotificationStateRows,
  listPositionHistoryStateRows,
  listPriceAlertStateRows,
  maybeFillOpenLimitOrders,
  requireAllowedExecutionType,
  requireAllowedPriceAlertExpiryDays,
  requireAllowedPriceAlertReference,
  requirePositivePrice,
  requirePositiveQuantity,
  upsertTradingPosition,
};

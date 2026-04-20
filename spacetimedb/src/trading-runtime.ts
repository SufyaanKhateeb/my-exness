import { SenderError } from 'spacetimedb/server';

import {
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_OPEN,
  ORDER_TYPE_LIMIT,
  ORDER_TYPE_MARKET,
  POSITION_EPSILON,
  type ExchangeCtx,
  type TradingAccountRowType,
  type TradeOrderRowType,
  type TradingPositionRowType,
  type TradingReadCtx,
} from './module';
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
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FILLED,
  ORDER_STATUS_OPEN,
  ORDER_TYPE_LIMIT,
  ORDER_TYPE_MARKET,
  POSITION_EPSILON,
  computeMarketPositionState,
  computeTradingAccountState,
  ensureMarketSnapshot,
  ensureTradingAccount,
  ensureTradingResourceAccess,
  executeAgainstOrderBook,
  fillTradeOrder,
  getAuth0UserIdBySenderIdentity,
  getAvailableBalance,
  getAvailablePositionQuantity,
  getPositionId,
  listMarketOrderStateRows,
  listMarketPositionStateRows,
  maybeFillOpenLimitOrders,
  requirePositivePrice,
  requirePositiveQuantity,
  upsertTradingPosition,
};

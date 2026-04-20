import { SenderError, t } from 'spacetimedb/server';

import spacetimedb, {
  marketOrderStateRow,
  marketPositionStateRow,
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_OPEN,
  ORDER_TYPE_LIMIT,
  ORDER_TYPE_MARKET,
  POSITION_EPSILON,
  tradingAccountStateRow,
} from './module';
import {
  DEFAULT_ACCOUNT_BALANCE,
  DEFAULT_ACCOUNT_CURRENCY,
} from './simulator-config';
import { getCurrentAuth0UserId } from './simulator-auth';
import {
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

const myMarketOrders = spacetimedb.view(
  { name: 'my_market_orders', public: true },
  t.array(marketOrderStateRow),
  ctx => {
    const auth0UserId = getAuth0UserIdBySenderIdentity(ctx, ctx.sender);
    return auth0UserId ? listMarketOrderStateRows(ctx, auth0UserId) : [];
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

const placeMarketOrder = spacetimedb.reducer(
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

const placeLimitOrder = spacetimedb.reducer(
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

export {
  cancelOrder,
  currentUserCanTrade,
  currentUserExists,
  myMarketOrders,
  myMarketPositionState,
  myTradingAccountState,
  placeLimitOrder,
  placeMarketOrder,
  syncCurrentUser,
};

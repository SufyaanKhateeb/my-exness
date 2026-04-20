import spacetimedb from './module';
import { ensureAuth0Jwt } from './simulator-auth';
import { seedSimulator } from './simulation-runtime';

const init = spacetimedb.init(ctx => {
  seedSimulator(ctx);
});

const onConnect = spacetimedb.clientConnected(ctx => {
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

const onDisconnect = spacetimedb.clientDisconnected(() => {
  // No-op for the simulator.
});

export { init, onConnect, onDisconnect };

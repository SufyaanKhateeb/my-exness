import spacetimedb, {
  bindTickMarketsReducer,
  marketTickScheduleRow,
} from './module';
import { RESET_SIMULATION_PERMISSION } from './simulator-config';
import { ensurePermission } from './simulator-auth';
import { resetSimulationState, tickAllMarkets } from './simulation-runtime';

const resetSimulation = spacetimedb.reducer(ctx => {
  ensurePermission(ctx, RESET_SIMULATION_PERMISSION);
  resetSimulationState(ctx);
});

const tickMarkets = spacetimedb.reducer(
  { arg: marketTickScheduleRow },
  ctx => {
    // if (ctx.sender != ctx.identity) {
    //   throw new SenderError('tickMarkets reducer can only be called by the scheduler');
    // }

    tickAllMarkets(ctx);
  }
);

bindTickMarketsReducer(tickMarkets);

export { resetSimulation, tickMarkets };

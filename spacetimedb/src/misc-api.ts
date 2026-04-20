import { t } from 'spacetimedb/server';

import spacetimedb from './module';
import { ensureAuth0Jwt } from './simulator-auth';

const add = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    ensureAuth0Jwt(ctx);
    ctx.db.person.insert({ name });
  }
);

const sayHello = spacetimedb.reducer(ctx => {
  ensureAuth0Jwt(ctx);
  for (const person of ctx.db.person.iter()) {
    console.info(`Hello, ${person.name}!`);
  }
  console.info('Hello, World!');
});

export { add, sayHello };

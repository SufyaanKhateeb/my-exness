# My Exness

My Exness is a Next.js trading UI backed by a SpacetimeDB module, with an optional Binance market-data ingestor running on Bun.

The repository contains three main parts:

- `app/`, `components/`, `lib/`: the Next.js frontend
- `spacetimedb/`: the SpacetimeDB module source
- `binance-ingestor/`: the Bun service that streams Binance data into SpacetimeDB

## Stack

- [Next.js](https://nextjs.org/docs)
- [SpacetimeDB](https://spacetimedb.com/docs)
- [Binance Spot API](https://developers.binance.com/docs/binance-spot-api-docs/overview)
- [Bun](https://bun.sh/docs)

## Prerequisites

Install these before starting local development:

- Node.js 20+
- npm
- Bun
- SpacetimeDB CLI
- An Auth0 tenant and app credentials

If you plan to publish or regenerate bindings often, also make sure your local SpacetimeDB CLI is working and authenticated for the environment you want to use.

## Environment Files

There are two environment files in this repo:

- frontend: [/.env.sample](/Users/sufyaan/Desktop/personal/my-exness/.env.sample)
- ingestor: [/binance-ingestor/.env.sample](/Users/sufyaan/Desktop/personal/my-exness/binance-ingestor/.env.sample)

Create working copies before running anything:

```bash
cp .env.sample .env
cp binance-ingestor/.env.sample binance-ingestor/.env
```

Keep the SpacetimeDB host/database values aligned between the frontend and the ingestor. If you are using the Binance ingestor, set `SPACETIMEDB_MARKET_DATA_MODE=external`.

## Install Dependencies

Install dependencies for the frontend:

```bash
npm install
```

Install dependencies for the ingestor:

```bash
cd binance-ingestor
bun install
```

## Local Development

### 1. Start SpacetimeDB

This repo is configured to use the module in [spacetimedb/](/Users/sufyaan/Desktop/personal/my-exness/spacetimedb) with local development values defined in [spacetime.json](/Users/sufyaan/Desktop/personal/my-exness/spacetime.json).

If you do not already have a local SpacetimeDB server running, start one with:

```bash
spacetime start --listen-addr='localhost:4000'
```

Build the module:

```bash
cd spacetimedb
npm run build
```

Publish it to your local SpacetimeDB server from the repo root:

```bash
spacetime publish next-exness-p83i0 -c --server self-hosted
```

If you change the module schema, you need to republish the module and regenerate the frontend bindings:

```bash
spacetime publish next-exness-p83i0 -c --server self-hosted
npm run spacetime:generate
```

### 2. Start the Frontend

From the repo root:

```bash
npm run dev
```

The app will be available at `http://localhost:3000` unless you change your Next.js setup.

### 3. Start the Binance Ingestor

The ingestor is optional. Use it when you want external market data instead of the simulator-driven market mode.

Run it from [binance-ingestor/](/Users/sufyaan/Desktop/personal/my-exness/binance-ingestor):

```bash
cd binance-ingestor
bun run dev
```

To seed historical candles manually:

```bash
cd binance-ingestor
bun run seed:history
```

## Common Commands

Frontend:

```bash
npm run dev
npm run build
npm run lint
npm run spacetime:generate
npm run spacetime:publish
```

SpacetimeDB module:

```bash
cd spacetimedb
npm run build
npm run publish
```

Binance ingestor:

```bash
cd binance-ingestor
bun run dev
bun run start
bun run seed:history
bun run typecheck
```

## Development Notes

- The frontend uses Auth0 for authentication and passes tokens to SpacetimeDB.
- The frontend reconnect logic lives in [components/SpacetimeConnectionProvider.tsx](/Users/sufyaan/Desktop/personal/my-exness/components/SpacetimeConnectionProvider.tsx).
- The ingestor expects Auth0 machine-to-machine credentials and appends `market:ingest` to its scope automatically when needed.
- If you remove or add reducers/procedures/tables in the SpacetimeDB module, regenerate bindings before continuing frontend work.

## Documentation Links

- Next.js: [https://nextjs.org/docs](https://nextjs.org/docs)
- SpacetimeDB: [https://spacetimedb.com/docs](https://spacetimedb.com/docs)
- Binance Spot API: [https://developers.binance.com/docs/binance-spot-api-docs/overview](https://developers.binance.com/docs/binance-spot-api-docs/overview)

import { DbConnection, type ErrorContext } from '../../src/module_bindings';
import { getSpacetimeIngestToken } from './auth0';
import { loadConfig, type IngestConfig, type IngestMarketConfig } from './config';
import { MS_PER_MINUTE, reseedMarketHistoryRange, seedLiveSnapshot } from './history';

function setFailureExitCode() {
  const processLike = (
    globalThis as {
      process?: {
        exitCode?: number;
      };
    }
  ).process;

  if (processLike) {
    processLike.exitCode = 1;
  }
}

async function connectSpacetime(config: IngestConfig) {
  const token = await getSpacetimeIngestToken(config);

  return new Promise<DbConnection>((resolve, reject) => {
    let settled = false;

    const connection = DbConnection.builder()
      .withUri(config.spacetimedbHost)
      .withDatabaseName(config.spacetimedbDatabase)
      .withToken(token)
      .onConnect(conn => {
        if (!settled) {
          settled = true;
          resolve(conn);
        }
      })
      .onConnectError((_ctx: ErrorContext, error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      })
      .build();

    void connection;
  });
}

async function bootstrapMarkets(connection: DbConnection, config: IngestConfig) {
  for (const market of config.markets) {
    await connection.reducers.bootstrapExternalMarket({
      marketId: market.marketId,
      symbol: market.symbol,
      baseAsset: market.baseAsset,
      quoteAsset: market.quoteAsset,
      assetClass: market.assetClass,
      precision: market.precision,
      spreadBps: market.spreadBps,
      changeRate: market.changeRate,
      quoteIntervalMs: market.quoteIntervalMs,
    });
  }
}

async function seedMarketHistory(
  connection: DbConnection,
  config: IngestConfig,
  market: IngestMarketConfig,
) {
  const endTime = Date.now();
  const startTime = endTime - config.historySeedDays * 24 * 60 * MS_PER_MINUTE;
  const { minuteCount, dayCount } = await reseedMarketHistoryRange(
    connection,
    config,
    market,
    startTime,
    endTime,
  );

  console.log('[binance-seed] Seeding history', {
    symbol: market.binanceSymbol,
    minutes: minuteCount,
    days: dayCount,
  });

  await seedLiveSnapshot(connection, config, market);
}

async function main() {
  const config = loadConfig();
  const connection = await connectSpacetime(config);

  try {
    await bootstrapMarkets(connection, config);

    for (const market of config.markets) {
      await seedMarketHistory(connection, config, market);
    }
  } finally {
    connection.disconnect();
  }
}

void main().catch(error => {
  console.error('[binance-seed] Fatal error', error);
  setFailureExitCode();
});
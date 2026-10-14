import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createDatabase } from './database.js';
import { runMigrations } from './db/migrate.js';
import { createPayoutProvider } from './payout/fakeProvider.js';

async function start() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const database = createDatabase({ connectionString: config.databaseUrl });
  let app;
  try {
    await runMigrations(database.pool, new URL('../db/migrations/', import.meta.url));
    app = buildApp({
      database,
      logger: config.nodeEnv !== 'test',
      allowedOrigins: config.allowedOrigins,
      secureCookies: config.secureCookies,
      fakeProvider: config.nodeEnv === 'production' ? null : createPayoutProvider('fake'),
      nodeEnv: config.nodeEnv,
    });
    app.addHook('onClose', async () => database.close());
    const address = await app.listen({ host: config.host, port: config.port });
    app.log.info({ address }, 'FlowPay API listening');

    const shutdown = async () => {
      try {
        await app.close();
      } catch {
        process.stderr.write('FlowPay API shutdown encountered an error.\n');
        process.exitCode = 1;
      }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    if (app) await app.close().catch(() => {});
    else await database.close().catch(() => {});
    process.stderr.write('FlowPay API startup failed. Check configuration and database availability.\n');
    process.exitCode = 1;
  }
}

start();

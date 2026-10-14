import { loadConfig } from '../config.js';
import { createDatabase } from '../database.js';
import { runMigrations } from './migrate.js';

let database;
try {
  const config = loadConfig();
  database = createDatabase({ connectionString: config.databaseUrl });
  await runMigrations(database.pool, new URL('../../db/migrations/', import.meta.url));
  process.stdout.write('Database migrations are up to date.\n');
} catch {
  process.stderr.write('Database migration failed. Check configuration and database availability.\n');
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => {});
}

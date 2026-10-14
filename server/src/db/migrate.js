import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATION_NAME = /^\d{4,}_[a-z0-9][a-z0-9_-]*\.sql$/;
const MIGRATION_LOCK_ID = '714563180912345';

export async function readMigrations(directory) {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const seen = new Set();
  const migrations = [];
  for (const name of names) {
    if (!MIGRATION_NAME.test(name)) throw new Error(`Invalid migration filename: ${name}`);
    if (seen.has(name)) throw new Error(`Duplicate migration: ${name}`);
    seen.add(name);
    const sql = await readFile(join(directory, name), 'utf8');
    if (sql.trim() === '') throw new Error(`Migration is empty: ${name}`);
    migrations.push({
      id: name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return migrations;
}

export async function runMigrations(pool, directory) {
  const migrations = await readMigrations(directory);
  const client = await pool.connect();
  let lockAcquired = false;
  let failure;

  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS flowpay_schema_migrations (
        id text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const result = await client.query('SELECT id, checksum FROM flowpay_schema_migrations ORDER BY id');
    const applied = new Map(result.rows.map(({ id, checksum }) => [id, checksum]));

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.id);
      if (existingChecksum !== undefined) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Migration checksum mismatch: ${migration.id}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO flowpay_schema_migrations (id, checksum) VALUES ($1, $2)',
          [migration.id, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* retain the original migration failure */ }
        throw error;
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    if (lockAcquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`);
      } catch (error) {
        failure ??= error;
      }
    }
    client.release();
  }

  if (failure) throw failure;
}

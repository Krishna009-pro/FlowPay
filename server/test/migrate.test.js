import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMigrations, runMigrations } from '../src/db/migrate.js';

async function withMigrationDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'flowpay-migrations-'));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '0002_second.sql'), 'select 2;');
    await writeFile(join(directory, '0001_first.sql'), 'select 1;');
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('loads SQL migrations in stable filename order and computes checksums', async () => {
  await withMigrationDirectory(async (directory) => {
    const migrations = await readMigrations(directory);
    assert.deepEqual(migrations.map(({ id }) => id), ['0001_first.sql', '0002_second.sql']);
    assert.ok(migrations.every(({ checksum }) => /^[a-f0-9]{64}$/.test(checksum)));
  });
});

test('applies each migration once and releases the database lock/client', async () => {
  await withMigrationDirectory(async (directory) => {
    const applied = new Map();
    const statements = [];
    const client = {
      async query(sql, values = []) {
        statements.push(sql.trim());
        if (sql.includes('SELECT id, checksum FROM flowpay_schema_migrations')) {
          return { rows: [...applied].map(([id, checksum]) => ({ id, checksum })) };
        }
        if (sql.includes('INSERT INTO flowpay_schema_migrations')) {
          applied.set(values[0], values[1]);
        }
        return { rows: [] };
      },
      release() { statements.push('RELEASE'); },
    };
    const pool = { connect: async () => client };

    await runMigrations(pool, directory);
    await runMigrations(pool, directory);

    assert.deepEqual([...applied.keys()], ['0001_first.sql', '0002_second.sql']);
    assert.equal(statements.filter((statement) => statement === 'select 1;').length, 1);
    assert.equal(statements.filter((statement) => statement === 'select 2;').length, 1);
    assert.equal(statements.filter((statement) => statement === 'RELEASE').length, 2);
    assert.equal(statements.filter((statement) => statement.includes('pg_advisory_unlock')).length, 2);
  });
});

test('refuses to run when an applied migration checksum has changed', async () => {
  await withMigrationDirectory(async (directory) => {
    const client = {
      async query(sql) {
        if (sql.includes('SELECT id, checksum FROM flowpay_schema_migrations')) {
          return { rows: [{ id: '0001_first.sql', checksum: 'outdated' }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    await assert.rejects(runMigrations({ connect: async () => client }, directory), /checksum mismatch/);
  });
});

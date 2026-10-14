import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';

test('database readiness uses a trivial query and close releases the pool', async () => {
  const calls = [];
  const pool = {
    query: async (sql) => { calls.push(sql); return { rows: [{ ok: 1 }] }; },
    end: async () => { calls.push('end'); },
  };
  const database = createDatabase({ connectionString: 'postgres://localhost/flowpay', PoolClass: class { constructor() { return pool; } } });

  await database.ping();
  await database.close();

  assert.deepEqual(calls, ['select 1 as ok', 'end']);
});

import pg from 'pg';

const { Pool } = pg;

export function createDatabase({ connectionString, PoolClass = Pool }) {
  const pool = new PoolClass({ connectionString, connectionTimeoutMillis: 5000 });

  return {
    async ping() {
      await pool.query('select 1 as ok');
    },
    async close() {
      await pool.end();
    },
    // Exposed for repositories and migration code; application routes receive only
    // the narrow ping/close interface unless they need a repository explicitly.
    pool,
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loads required database URL and safe local defaults', () => {
  const config = loadConfig({ DATABASE_URL: 'postgres://flowpay:local@127.0.0.1:5433/flowpay' });

  assert.equal(config.databaseUrl, 'postgres://flowpay:local@127.0.0.1:5433/flowpay');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3001);
  assert.equal(config.nodeEnv, 'development');
  assert.deepEqual(config.allowedOrigins, ['http://localhost:5173']);
  assert.equal(config.secureCookies, false);
});

test('rejects missing or malformed database configuration', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'file:payroll.db' }), /DATABASE_URL/);
});

test('rejects invalid ports instead of silently coercing them', () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'postgres://localhost/flowpay', PORT: '70000' }),
    /PORT/,
  );
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'postgres://localhost/flowpay', PORT: 'abc' }),
    /PORT/,
  );
});

test('requires explicit valid browser origins without paths', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/flowpay', APP_ORIGINS: '' }), /APP_ORIGINS/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/flowpay', APP_ORIGINS: 'https://example.test/app' }), /origins/);
  const config = loadConfig({ DATABASE_URL: 'postgres://localhost/flowpay', NODE_ENV: 'production', APP_ORIGINS: 'https://pay.example,https://admin.example' });
  assert.equal(config.secureCookies, true);
  assert.deepEqual(config.allowedOrigins, ['https://pay.example', 'https://admin.example']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

test('health reports API liveness without claiming database readiness', async () => {
  const app = buildApp({ database: { ping: async () => { throw new Error('db should not be called'); } } });

  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  } finally {
    await app.close();
  }
});

test('readiness reports a healthy database', async () => {
  const app = buildApp({ database: { ping: async () => undefined } });

  try {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ready' });
  } finally {
    await app.close();
  }
});

test('readiness fails closed and does not disclose database errors', async () => {
  const app = buildApp({ database: { ping: async () => { throw new Error('postgres password leaked'); } } });

  try {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: 'not_ready' });
    assert.equal(response.body.includes('postgres password leaked'), false);
  } finally {
    await app.close();
  }
});

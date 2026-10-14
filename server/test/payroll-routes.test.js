import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createPayoutProvider } from '../src/payout/fakeProvider.js';

function database() { return { ping: async () => {}, pool: { query: async () => ({ rows: [], rowCount: 0 }) } }; }

test('registers local synthetic and fake-payout endpoints only outside production', async () => {
  const local = buildApp({ database: database(), fakeProvider: createPayoutProvider('fake'), nodeEnv: 'development' });
  const production = buildApp({ database: database(), fakeProvider: null, nodeEnv: 'production' });
  try {
    await local.ready();
    await production.ready();
    assert.equal(local.hasRoute({ method: 'POST', url: '/api/dev/synthetic/organizations/:organizationId/employees/:employeeId/periods/:periodId/accrue' }), true);
    assert.equal(local.hasRoute({ method: 'POST', url: '/api/dev/fake-payout/dispatch-one' }), true);
    assert.equal(production.hasRoute({ method: 'POST', url: '/api/dev/synthetic/organizations/:organizationId/employees/:employeeId/periods/:periodId/accrue' }), false);
    assert.equal(production.hasRoute({ method: 'POST', url: '/api/dev/fake-payout/dispatch-one' }), false);
  } finally {
    await local.close();
    await production.close();
  }
});

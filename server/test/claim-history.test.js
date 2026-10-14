import test from 'node:test';
import assert from 'node:assert/strict';
import { listEmployeeClaims, listOrganizationClaims } from '../src/repositories/claims.js';

const ORG = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const WALLET = `0x${'a'.repeat(40)}`;

test('employee claim history is tenant and wallet scoped and returns safe paise amounts', async () => {
  let call;
  const pool = { query: async (sql, values) => {
    call = { sql, values };
    return { rows: [{ id: 'claim-1', periodId: 'period-1', requested_paise: '2500', reserved_paise: '2500',
      state: 'submitted', policyVersion: 'v1', createdAt: new Date(0), updatedAt: new Date(1), providerReference: 'fake_ref' }] };
  } };
  const claims = await listEmployeeClaims(pool, { organizationId: ORG, walletAddress: WALLET });
  assert.deepEqual(call.values, [ORG, WALLET, 50]);
  assert.match(call.sql, /e\.wallet_address = \$2/);
  assert.match(call.sql, /c\.organization_id = \$1/);
  assert.equal(claims[0].requestedPaise, 2500);
  assert.equal(claims[0].reservedPaise, 2500);
  assert.equal(claims[0].providerReference, 'fake_ref');
});

test('employee claim history rejects invalid limits and unsafe database amounts', async () => {
  const pool = { query: async () => ({ rows: [{ requested_paise: '9007199254740992', reserved_paise: '0' }] }) };
  await assert.rejects(listEmployeeClaims(pool, { organizationId: ORG, walletAddress: WALLET, limit: 101 }), /limit/);
  await assert.rejects(listEmployeeClaims(pool, { organizationId: ORG, walletAddress: WALLET }), /safe integer/);
});

test('organization claim queue checks active tenant membership and returns review metadata', async () => {
  let count = 0;
  const pool = { query: async (_sql, values) => {
    count += 1;
    if (count === 1) return { rows: [{ ok: 1 }], rowCount: 1 };
    assert.deepEqual(values, [ORG, 100]);
    return { rows: [{ id: 'claim-2', employeeId: 'employee-1', employeeRef: 'EMP-1', periodId: 'period-1',
      requested_paise: '5000', reserved_paise: '5000', state: 'awaiting_approval', policyVersion: 'v1',
      preparedByWallet: WALLET, approvedByWallet: null, createdAt: new Date(0), updatedAt: new Date(0), providerReference: null }] };
  } };
  const claims = await listOrganizationClaims(pool, { organizationId: ORG, actorWallet: WALLET });
  assert.equal(claims[0].state, 'awaiting_approval');
  assert.equal(claims[0].requestedPaise, 5000);
  assert.equal(claims[0].employeeRef, 'EMP-1');
  const forbidden = { query: async () => ({ rows: [], rowCount: 0 }) };
  await assert.rejects(listOrganizationClaims(forbidden, { organizationId: ORG, actorWallet: WALLET }), /membership/);
});

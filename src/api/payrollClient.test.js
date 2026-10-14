import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollClient } from './payrollClient.js';

test('payroll API client sends same-origin credentials and JSON for mutations', async () => {
  const calls = [];
  const client = createPayrollClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return { ok: true, json: async () => ({ id: 'org-1' }) };
  } });
  await client.createOrganization('Synthetic Org');
  assert.equal(calls[0].path, '/api/organizations');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(JSON.parse(calls[0].options.body).legalName, 'Synthetic Org');
});

test('payroll client treats expired sessions as signed out and surfaces API errors', async () => {
  const client = createPayrollClient({ fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'wallet_session_required' }) }) });
  assert.equal(await client.session(), null);
  await assert.rejects(client.organizations(), /wallet_session_required/);
});

test('sign in signs the one-time challenge and verifies it without exposing session tokens', async () => {
  const calls = [];
  const client = createPayrollClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return { ok: true, json: async () => path.endsWith('/challenge') ? { message: 'challenge to sign' } : { walletAddress: '0x123' } };
  } });
  let signed;
  const session = await client.signIn({ walletAddress: '0x123', signMessage: async (message) => { signed = message; return '0xsig'; } });
  assert.equal(signed, 'challenge to sign');
  assert.equal(session.walletAddress, '0x123');
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { message: 'challenge to sign', signature: '0xsig' });
  assert.doesNotMatch(JSON.stringify(calls), /token|secret/i);
});

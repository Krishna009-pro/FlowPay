import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollAuthClient } from './payrollAuth.js';

test('sign-in requests a one-time challenge, asks the wallet to sign, then accepts a session', async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return path.endsWith('/challenge')
      ? { ok: true, json: async () => ({ message: 'exact challenge message' }) }
      : { ok: true, json: async () => ({ walletAddress: '0xabc', expiresAt: '2026-10-13T10:15:00.000Z' }) };
  };
  const signMessage = async (message) => `signed:${message}`;
  const auth = createPayrollAuthClient({ fetchImpl });

  const session = await auth.signIn({ walletAddress: '0xabc', signMessage });
  assert.equal(session.walletAddress, '0xabc');
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].options.body), { walletAddress: '0xabc' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { message: 'exact challenge message', signature: 'signed:exact challenge message' });
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[1].options.credentials, 'same-origin');
});

test('restores and revokes a session without storing a session token in browser code', async () => {
  const calls = [];
  const auth = createPayrollAuthClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return path.endsWith('/session')
      ? { ok: true, status: 200, json: async () => ({ walletAddress: '0xabc' }) }
      : { ok: true, status: 204, json: async () => ({}) };
  } });
  assert.deepEqual(await auth.getSession(), { walletAddress: '0xabc' });
  await auth.signOut();
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(Object.hasOwn(calls[1].options, 'body'), false);
});

test('returns signed-out state for expired sessions and surfaces wallet/API failures', async () => {
  const unauthenticated = createPayrollAuthClient({ fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(await unauthenticated.getSession(), null);
  await assert.rejects(unauthenticated.signIn({ walletAddress: '0xabc', signMessage: async () => 'x' }), /Payroll API request failed/);
  const auth = createPayrollAuthClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ message: 'sign this' }) }) });
  await assert.rejects(auth.signIn({ walletAddress: '0xabc' }), /signMessage is required/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { performWalletAction } from './transactionFlow.js';

test('wallet action stays pending until receipt, then refreshes confirmed state', async () => {
  const states = [];
  const sequence = [];
  let resolveReceipt;
  const waitReceipt = new Promise((resolve) => { resolveReceipt = resolve; });
  const action = performWalletAction({
    label: 'Create stream',
    send: async () => { sequence.push('send'); return '0xhash'; },
    waitForReceipt: async () => { sequence.push('wait'); return waitReceipt; },
    refresh: async () => sequence.push('refresh'),
    errorMessage: (error) => error.message,
    onTransaction: (state) => states.push(state),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(states.map(({ status }) => status), ['wallet', 'pending']);
  assert.deepEqual(sequence, ['send', 'wait']);

  resolveReceipt({ status: 'success' });
  assert.equal(await action, true);
  assert.deepEqual(states.map(({ status }) => status), ['wallet', 'pending', 'confirmed']);
  assert.deepEqual(sequence, ['send', 'wait', 'refresh']);
});

test('reverted receipt becomes an error and does not refresh balances', async () => {
  const states = [];
  let refreshed = false;
  const result = await performWalletAction({
    label: 'Claim salary', send: async () => '0xhash',
    waitForReceipt: async () => ({ status: 'reverted' }),
    refresh: async () => { refreshed = true; },
    errorMessage: (error) => error.message,
    onTransaction: (state) => states.push(state),
  });
  assert.equal(result, false);
  assert.equal(refreshed, false);
  assert.equal(states.at(-1).status, 'error');
  assert.match(states.at(-1).message, /transaction reverted/i);
});

test('wallet rejection is reported as an error without waiting for a receipt', async () => {
  const states = [];
  const result = await performWalletAction({
    label: 'Top up', send: async () => { throw Object.assign(new Error('user rejected'), { code: 4001 }); },
    waitForReceipt: async () => { throw new Error('must not wait'); },
    refresh: async () => { throw new Error('must not refresh'); },
    errorMessage: () => 'The wallet request was cancelled.',
    onTransaction: (state) => states.push(state),
  });
  assert.equal(result, false);
  assert.deepEqual(states.map(({ status }) => status), ['wallet', 'error']);
  assert.equal(states.at(-1).message, 'The wallet request was cancelled.');
});

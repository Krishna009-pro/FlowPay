import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayoutProvider, FakePayoutProvider } from '../src/payout/fakeProvider.js';

test('fake payout is stable under duplicate idempotency keys and marks its evidence fake', async () => {
  const provider = new FakePayoutProvider({ scenario: 'success' });
  const command = { idempotencyKey: 'claim-1', amountPaise: 5000, recipientRef: 'fake-recipient-1' };
  const first = await provider.createPayout(command);
  const duplicate = await provider.createPayout(command);
  assert.deepEqual(duplicate, first);
  assert.equal(provider.createCount, 1);
  assert.equal(first.state, 'paid');
  assert.equal(first.fake, true);
  assert.match(first.reference, /^fake_/);
});

test('models pending, ambiguous timeout, hard failure, returned and reversed scenarios', async () => {
  const pending = new FakePayoutProvider({ scenario: 'pending' });
  assert.equal((await pending.createPayout({ idempotencyKey: 'pending', amountPaise: 1, recipientRef: 'fake' })).state, 'submitted');

  const timeout = new FakePayoutProvider({ scenario: 'timeout' });
  await assert.rejects(timeout.createPayout({ idempotencyKey: 'timeout', amountPaise: 1, recipientRef: 'fake' }), { code: 'FAKE_AMBIGUOUS_TIMEOUT' });
  assert.equal((await timeout.getPayoutStatus('timeout')).state, 'reconciliation_required');
  await assert.rejects(timeout.createPayout({ idempotencyKey: 'timeout', amountPaise: 1, recipientRef: 'fake' }), { code: 'FAKE_AMBIGUOUS_TIMEOUT' });
  assert.equal(timeout.createCount, 1);

  const failure = new FakePayoutProvider({ scenario: 'failure' });
  assert.equal((await failure.createPayout({ idempotencyKey: 'failure', amountPaise: 1, recipientRef: 'fake' })).state, 'failed');

  for (const scenario of ['returned', 'reversed']) {
    const provider = new FakePayoutProvider({ scenario });
    const initial = await provider.createPayout({ idempotencyKey: scenario, amountPaise: 1, recipientRef: 'fake' });
    assert.equal(initial.state, 'paid');
    assert.equal((await provider.getPayoutStatus(scenario)).state, scenario);
  }
});

test('verifies fake webhook evidence and rejects a real provider selection', async () => {
  const provider = createPayoutProvider('fake', { scenario: 'success' });
  const payout = await provider.createPayout({ idempotencyKey: 'callback', amountPaise: 25, recipientRef: 'synthetic' });
  const callback = { idempotencyKey: 'callback', state: 'paid', reference: payout.reference };
  const signature = provider.signFakeCallback(callback);
  assert.equal(provider.verifyWebhook(callback, signature), true);
  assert.equal(provider.verifyWebhook(callback, 'real-provider-signature'), false);
  assert.throws(() => createPayoutProvider('bank'), /fake provider only/);
});

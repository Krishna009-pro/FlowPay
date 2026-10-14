import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActivityState } from './activityState.js';

test('empty activity distinguishes setup, read error, loading, and a genuine empty history', () => {
  assert.deepEqual(emptyActivityState({ setupError: 'No contract configured' }), {
    title: 'Fresh contract required', body: 'No contract configured',
  });
  assert.deepEqual(emptyActivityState({ error: 'RPC unavailable' }), {
    title: 'Activity unavailable', body: 'RPC unavailable',
  });
  assert.deepEqual(emptyActivityState({ loading: true }), {
    title: 'Reading Monad Testnet', body: 'Loading confirmed events from the deployment block.',
  });
  assert.deepEqual(emptyActivityState({}), {
    title: 'No contract events yet', body: 'Confirmed actions will appear after the first contract transaction.',
  });
});

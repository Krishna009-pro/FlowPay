import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeWalletEvents } from './walletEvents.js';

test('wallet account and chain changes are forwarded and unsubscribe cleanly', () => {
  const listeners = new Map();
  const seen = [];
  const provider = {
    on: (event, listener) => listeners.set(event, listener),
    removeListener: (event, listener) => {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
  };
  const unsubscribe = subscribeWalletEvents(provider, {
    onAccounts: (accounts) => seen.push(['accounts', accounts]),
    onChain: (chainId) => seen.push(['chain', chainId]),
  });

  listeners.get('accountsChanged')(['0xabc']);
  listeners.get('chainChanged')('0x279f');
  assert.deepEqual(seen, [['accounts', ['0xabc']], ['chain', 10_143]]);

  unsubscribe();
  assert.equal(listeners.size, 0);
});

test('wallet event subscription is a no-op for a provider without event support', () => {
  assert.doesNotThrow(() => subscribeWalletEvents({}, { onAccounts() {}, onChain() {} }));
});

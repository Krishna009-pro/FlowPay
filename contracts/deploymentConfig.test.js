import test from 'node:test';
import assert from 'node:assert/strict';
import { readDeploymentPrivateKey } from './deploymentConfig.js';

test('deployment key comes only from PRIVATE_KEY environment variable', () => {
  assert.equal(readDeploymentPrivateKey({ PRIVATE_KEY: 'ab'.repeat(32) }), `0x${'ab'.repeat(32)}`);
});

test('deployment key is required and never falls back to a positional argument', () => {
  assert.throws(() => readDeploymentPrivateKey({}), /PRIVATE_KEY environment variable/);
});

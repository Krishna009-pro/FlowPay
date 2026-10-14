import test from 'node:test';
import assert from 'node:assert/strict';
import { nextClaimStateForProvider, normalizeProviderState } from '../src/domain/payoutTransitions.js';

test('maps explicit fake provider outcomes to claim and payout states', () => {
  assert.equal(normalizeProviderState('submitted'), 'submitted');
  assert.equal(normalizeProviderState('paid'), 'paid');
  assert.equal(normalizeProviderState('failed'), 'failed');
  assert.equal(normalizeProviderState('returned'), 'returned');
  assert.equal(normalizeProviderState('reversed'), 'reversed');
  assert.equal(normalizeProviderState('reconciliation_required'), 'reconciliation_required');
  assert.throws(() => normalizeProviderState('unknown'), /unsupported payout outcome/);
});

test('holds ambiguous provider outcomes and never retries them as fresh claims', () => {
  assert.equal(nextClaimStateForProvider('queued', 'reconciliation_required'), 'reconciliation_required');
  assert.equal(nextClaimStateForProvider('submitted', 'reconciliation_required'), 'reconciliation_required');
  assert.throws(() => nextClaimStateForProvider('paid', 'failed'), /invalid payout state transition/);
  assert.throws(() => nextClaimStateForProvider('failed', 'paid'), /invalid payout state transition/);
});

test('accepts only forward settlement and confirmed return/reversal transitions', () => {
  assert.equal(nextClaimStateForProvider('queued', 'submitted'), 'submitted');
  assert.equal(nextClaimStateForProvider('queued', 'paid'), 'paid');
  assert.equal(nextClaimStateForProvider('submitted', 'failed'), 'failed');
  assert.equal(nextClaimStateForProvider('paid', 'returned'), 'returned');
  assert.equal(nextClaimStateForProvider('paid', 'reversed'), 'reversed');
  assert.throws(() => nextClaimStateForProvider('queued', 'returned'), /requires a previously paid claim/);
});

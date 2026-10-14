import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSnapshot } from './projectSnapshot.js';

const snapshot = (overrides = {}) => ({
  streamCreated: true,
  paused: false,
  underfunded: false,
  ratePerSecond: 2n,
  availableToVest: 100n,
  totalVested: 10n,
  salaryClaimable: 8n,
  savingsClaimable: 2n,
  savingsRateBps: 1_000,
  savingsRemainder: 0n,
  ...overrides,
});

test('projects live accrual and caps it at remaining funded balance', () => {
  const live = projectSnapshot(snapshot({ availableToVest: 3n }), 100, 110);
  assert.equal(live.totalVested, 13n);
  assert.equal(live.salaryClaimable, 11n);
  assert.equal(live.savingsClaimable, 2n);
  assert.equal(live.availableToVest, 0n);
});

test('does not project while paused or underfunded', () => {
  assert.equal(projectSnapshot(snapshot({ paused: true }), 100, 110).totalVested, 10n);
  assert.equal(projectSnapshot(snapshot({ underfunded: true }), 100, 110).totalVested, 10n);
});

test('freezes the live counter when the latest chain read failed', () => {
  const live = projectSnapshot(snapshot(), 100, 110, false);
  assert.equal(live.totalVested, 10n);
  assert.equal(live.salaryClaimable, 8n);
  assert.equal(live.availableToVest, 100n);
});

test('returns null when no contract snapshot exists', () => {
  assert.equal(projectSnapshot(null, 100, 110), null);
});

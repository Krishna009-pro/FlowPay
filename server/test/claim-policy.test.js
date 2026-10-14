import test from 'node:test';
import assert from 'node:assert/strict';
import { decideClaim } from '../src/domain/claimPolicy.js';

const policy = {
  version: 'v1',
  minimumClaimPaise: 100,
  maximumClaimPaise: 10_000,
  maximumDailyClaims: 2,
  maximumMonthlyClaims: 5,
  autoPayMaximumPaise: 5_000,
};

test('automatically authorizes an in-policy partial claim', () => {
  assert.deepEqual(decideClaim({ requestedPaise: 2_000, availablePaise: 10_000, dailyClaimCount: 0, monthlyClaimCount: 1, policy }), {
    decision: 'auto', policyVersion: 'v1', reasons: [],
  });
});

test('routes policy-cap and frequency exceptions for approval without bypassing balance', () => {
  assert.deepEqual(decideClaim({ requestedPaise: 6_000, availablePaise: 10_000, dailyClaimCount: 0, monthlyClaimCount: 1, policy }), {
    decision: 'approval_required', policyVersion: 'v1', reasons: ['auto_pay_limit_exceeded'],
  });
  assert.deepEqual(decideClaim({ requestedPaise: 11_000, availablePaise: 20_000, dailyClaimCount: 2, monthlyClaimCount: 5, policy }), {
    decision: 'approval_required', policyVersion: 'v1', reasons: ['claim_limit_exceeded', 'daily_frequency_exceeded', 'monthly_frequency_exceeded', 'auto_pay_limit_exceeded'],
  });
  assert.throws(() => decideClaim({ requestedPaise: 10_001, availablePaise: 10_000, dailyClaimCount: 9, monthlyClaimCount: 9, policy }), /available balance/);
});

test('rejects invalid amounts, balances, counters, and malformed policies', () => {
  assert.throws(() => decideClaim({ requestedPaise: 0, availablePaise: 10, dailyClaimCount: 0, monthlyClaimCount: 0, policy }), /positive safe integer/);
  assert.throws(() => decideClaim({ requestedPaise: 101, availablePaise: 10, dailyClaimCount: 0, monthlyClaimCount: 0, policy }), /available balance/);
  assert.throws(() => decideClaim({ requestedPaise: 10, availablePaise: 10, dailyClaimCount: -1, monthlyClaimCount: 0, policy }), /claim counts/);
});

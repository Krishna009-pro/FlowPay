import test from 'node:test';
import assert from 'node:assert/strict';
import { approveClaimPolicy, getApprovedClaimPolicy, listClaimPolicies, proposeClaimPolicy } from '../src/repositories/claimPolicies.js';

const ORG_ID = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const POLICY_ID = '03942c34-18d8-4c65-8571-2a15ac32ae17';
const MAKER = `0x${'1'.repeat(40)}`;
const CHECKER = `0x${'2'.repeat(40)}`;

function mockPool({ authorized = true, pending = null, approved = null } = {}) {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [], rowCount: 0 };
      if (normalized.includes('FROM organization_memberships')) return { rows: authorized ? [{ ok: 1 }] : [], rowCount: authorized ? 1 : 0 };
      if (normalized.includes('FROM claim_policies') && normalized.includes("status = 'pending_approval'")) return { rows: pending ? [pending] : [], rowCount: pending ? 1 : 0 };
      if (normalized.includes('FROM claim_policies') && normalized.includes("status = 'approved'")) return { rows: approved ? [approved] : [], rowCount: approved ? 1 : 0 };
      if (normalized.includes('UPDATE claim_policies')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, queries };
}

test('proposes a versioned claim policy as pending, never active immediately', async () => {
  const { pool, queries } = mockPool();
  const policy = await proposeClaimPolicy(pool, {
    organizationId: ORG_ID, actorWallet: MAKER, requestId: 'policy-request-1', version: 'v1',
    minimumClaimPaise: 100, maximumClaimPaise: 10_000, maximumDailyClaims: 2,
    maximumMonthlyClaims: 5, autoPayMaximumPaise: 2_000,
  });
  assert.equal(policy.status, 'pending_approval');
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO claim_policies')));
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO audit_events')));
});

test('rejects inconsistent limits and requires an authorized maker', async () => {
  await assert.rejects(proposeClaimPolicy(mockPool().pool, {
    organizationId: ORG_ID, actorWallet: MAKER, requestId: 'policy-request-2', version: 'bad',
    minimumClaimPaise: 100, maximumClaimPaise: 10_000, maximumDailyClaims: 5,
    maximumMonthlyClaims: 2, autoPayMaximumPaise: 2_000,
  }), /monthly/);
  await assert.rejects(proposeClaimPolicy(mockPool({ authorized: false }).pool, {
    organizationId: ORG_ID, actorWallet: MAKER, requestId: 'policy-request-3', version: 'v2',
    minimumClaimPaise: 100, maximumClaimPaise: 10_000, maximumDailyClaims: 2,
    maximumMonthlyClaims: 5, autoPayMaximumPaise: 2_000,
  }), /operator membership required/);
});

test('requires a distinct checker and supersedes the prior active policy', async () => {
  const pending = {
    id: POLICY_ID, version: 'v2', status: 'pending_approval', prepared_by_wallet: MAKER,
    minimum_claim_paise: '100', maximum_claim_paise: '10000', maximum_daily_claims: 2,
    maximum_monthly_claims: 5, auto_pay_maximum_paise: '2000',
  };
  const active = { id: 'old-policy', version: 'v1' };
  const { pool, queries } = mockPool({ pending, approved: active });
  const result = await approveClaimPolicy(pool, {
    organizationId: ORG_ID, policyId: POLICY_ID, actorWallet: CHECKER, requestId: 'policy-request-4',
  });
  assert.equal(result.status, 'approved');
  assert.ok(queries.some(({ sql, values }) => sql.includes("SET status = 'superseded'") && values.includes('old-policy')));
  await assert.rejects(approveClaimPolicy(mockPool({ pending }).pool, {
    organizationId: ORG_ID, policyId: POLICY_ID, actorWallet: MAKER, requestId: 'policy-request-5',
  }), /different wallet/);
});

test('lists tenant-scoped claim policy history with safe integer paise values', async () => {
  let calls = 0;
  const pool = { query: async (_sql, values) => {
    calls += 1;
    if (calls === 1) return { rows: [{ ok: 1 }], rowCount: 1 };
    assert.deepEqual(values, [ORG_ID]);
    return { rows: [{ id: POLICY_ID, version: 'v1', minimumClaimPaise: '100', maximumClaimPaise: '10000',
      maximumDailyClaims: 2, maximumMonthlyClaims: 5, autoPayMaximumPaise: '2000', status: 'approved' }] };
  } };
  const policies = await listClaimPolicies(pool, { organizationId: ORG_ID, actorWallet: MAKER });
  assert.equal(policies[0].minimumClaimPaise, 100);
  assert.equal(policies[0].maximumClaimPaise, 10_000);
  const denied = { query: async () => ({ rows: [], rowCount: 0 }) };
  await assert.rejects(listClaimPolicies(denied, { organizationId: ORG_ID, actorWallet: MAKER }), /membership/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { requestEmployeeClaim } from '../src/repositories/claims.js';

const ORG_ID = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const PERIOD_ID = '03942c34-18d8-4c65-8571-2a15ac32ae17';
const EMPLOYEE_ID = '86c62dcc-723e-4356-bd4e-59b6eb678e07';
const EMPLOYEE_WALLET = `0x${'3'.repeat(40)}`;
const CLAIM_ID = 'd8e7499b-1690-40e8-b62d-e8177542bc6b';

function mockPool({ available = 10_000, policy = {
  version: 'policy-1', minimum_claim_paise: 100, maximum_claim_paise: 5_000,
  maximum_daily_claims: 2, maximum_monthly_claims: 5, auto_pay_maximum_paise: 3_000,
}, counts = { daily: 0, monthly: 1 }, existingClaim = null } = {}) {
  const statements = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: normalized, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [], rowCount: 0 };
      if (normalized.includes('FROM employees') && normalized.includes('FOR UPDATE')) return { rows: [{ id: EMPLOYEE_ID, status: 'active' }], rowCount: 1 };
      if (normalized.includes('FROM claims') && normalized.includes('idempotency_key =')) return { rows: existingClaim ? [existingClaim] : [], rowCount: existingClaim ? 1 : 0 };
      if (normalized.includes('FROM payroll_periods')) return { rows: [{ id: PERIOD_ID, status: 'open', starts_at: new Date('2026-10-01T00:00:00Z'), ends_at: new Date('2026-11-01T00:00:00Z') }], rowCount: 1 };
      if (normalized.includes('FROM claim_policies')) return { rows: policy ? [policy] : [], rowCount: policy ? 1 : 0 };
      if (normalized.includes('count(*) FILTER')) return { rows: [{ daily_count: counts.daily, monthly_count: counts.monthly }], rowCount: 1 };
      if (normalized.includes('FROM earning_ledger_entries')) return { rows: [{ entry_type: 'accrual', amount_paise: available, idempotency_key: 'accrual-1', linked_entry_id: null }], rowCount: 1 };
      if (normalized.includes('FROM payout_recipient_references')) return { rows: [{ provider_recipient_ref: 'fake-recipient-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, statements };
}

test('reserves an in-policy employee claim and writes its outbox command atomically', async () => {
  const { pool, statements } = mockPool();
  const claim = await requestEmployeeClaim(pool, {
    organizationId: ORG_ID, walletAddress: EMPLOYEE_WALLET, requestedPaise: 2_500,
    idempotencyKey: 'client-claim-1', requestId: 'request-1', now: new Date('2026-10-14T06:30:00Z'),
  });
  assert.equal(claim.state, 'queued');
  assert.equal(claim.decision, 'auto');
  assert.ok(statements.findIndex(({ sql }) => sql === 'BEGIN') < statements.findIndex(({ sql }) => sql.includes('INSERT INTO claims')));
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO earning_ledger_entries')));
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO payout_outbox')));
  assert.ok(statements.findIndex(({ sql }) => sql.includes('INSERT INTO payout_outbox')) < statements.findIndex(({ sql }) => sql === 'COMMIT'));
});

test('reserves exception claims for checker approval and rejects requests that exceed earnings', async () => {
  const exception = await requestEmployeeClaim(mockPool().pool, {
    organizationId: ORG_ID, walletAddress: EMPLOYEE_WALLET, requestedPaise: 4_000,
    idempotencyKey: 'client-claim-2', requestId: 'request-2', now: new Date('2026-10-14T06:30:00Z'),
  });
  assert.equal(exception.state, 'awaiting_approval');
  assert.equal(exception.decision, 'approval_required');
  await assert.rejects(requestEmployeeClaim(mockPool({ available: 1_000 }).pool, {
    organizationId: ORG_ID, walletAddress: EMPLOYEE_WALLET, requestedPaise: 1_001,
    idempotencyKey: 'client-claim-3', requestId: 'request-3', now: new Date('2026-10-14T06:30:00Z'),
  }), /available balance/);
});

test('requires a current approved policy and a verified fake recipient', async () => {
  await assert.rejects(requestEmployeeClaim(mockPool({ policy: null }).pool, {
    organizationId: ORG_ID, walletAddress: EMPLOYEE_WALLET, requestedPaise: 500,
    idempotencyKey: 'client-claim-4', requestId: 'request-4', now: new Date('2026-10-14T06:30:00Z'),
  }), /approved claim policy/);
  const recipientless = mockPool();
  const originalConnect = recipientless.pool.connect;
  recipientless.pool.connect = async () => {
    const client = await originalConnect();
    const originalQuery = client.query;
    client.query = async (sql, values) => sql.includes('FROM payout_recipient_references') ? { rows: [], rowCount: 0 } : originalQuery(sql, values);
    return client;
  };
  await assert.rejects(requestEmployeeClaim(recipientless.pool, {
    organizationId: ORG_ID, walletAddress: EMPLOYEE_WALLET, requestedPaise: 500,
    idempotencyKey: 'client-claim-5', requestId: 'request-5', now: new Date('2026-10-14T06:30:00Z'),
  }), /verified payout recipient/);
});

test('makes claim retries idempotent and rejects key reuse for another amount', async () => {
  const existing = { id: CLAIM_ID, requested_paise: '2500', state: 'queued', policy_version: 'policy-1' };
  const { pool, statements } = mockPool({ existingClaim: existing });
  const retried = await requestEmployeeClaim(pool, {
    organizationId: ORG_ID, walletAddress: EMPLOYEE_WALLET, requestedPaise: 2_500,
    idempotencyKey: 'client-claim-1', requestId: 'request-6', now: new Date('2026-10-14T06:30:00Z'),
  });
  assert.equal(retried.id, CLAIM_ID);
  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO payout_outbox')), false);
  await assert.rejects(requestEmployeeClaim(mockPool({ existingClaim: existing }).pool, {
    organizationId: ORG_ID, walletAddress: EMPLOYEE_WALLET, requestedPaise: 2_600,
    idempotencyKey: 'client-claim-1', requestId: 'request-7', now: new Date('2026-10-14T06:30:00Z'),
  }), /idempotency key was already used/);
});

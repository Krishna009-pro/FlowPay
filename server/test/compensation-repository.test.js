import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeCompensationTerm, approveCompensationTerm } from '../src/repositories/compensation.js';

const ORG_ID = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const EMPLOYEE_ID = '03942c34-18d8-4c65-8571-2a15ac32ae17';
const TERM_ID = '86c62dcc-723e-4356-bd4e-59b6eb678e07';
const MAKER = `0x${'1'.repeat(40)}`;
const CHECKER = `0x${'2'.repeat(40)}`;

function mockPool({ authorized = true, term = null, closedPeriod = false } = {}) {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, values });
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (normalized.includes('FROM organization_memberships')) return { rows: authorized ? [{ ok: 1 }] : [], rowCount: authorized ? 1 : 0 };
      if (normalized.includes('FROM employees')) return { rows: [{ status: 'active' }], rowCount: 1 };
      if (normalized.includes('FROM payroll_periods')) return { rows: closedPeriod ? [{ exists: true }] : [], rowCount: closedPeriod ? 1 : 0 };
      if (normalized.includes('FROM compensation_terms')) return { rows: term ? [term] : [], rowCount: term ? 1 : 0 };
      if (normalized.includes('UPDATE compensation_terms')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { queries, pool: { connect: async () => client } };
}

test('proposes positive integer-paise compensation inside a tenant and audits it', async () => {
  const { pool, queries } = mockPool();
  const result = await proposeCompensationTerm(pool, {
    organizationId: ORG_ID, employeeId: EMPLOYEE_ID, actorWallet: MAKER,
    periodGrossPaise: 8_500_000, periodKind: 'monthly',
    effectiveFrom: '2026-11-01T00:00:00.000Z', requestId: 'request-1',
  });
  assert.equal(result.status, 'pending_approval');
  assert.equal(result.periodGrossPaise, 8_500_000);
  assert.ok(queries.some(({ sql, values }) => sql.includes('INSERT INTO compensation_terms') && values.includes(ORG_ID) && values.includes(EMPLOYEE_ID)));
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO audit_events')));
});

test('rejects retroactive terms, invalid money and unauthorized tenant members', async () => {
  const closed = mockPool({ closedPeriod: true });
  await assert.rejects(proposeCompensationTerm(closed.pool, {
    organizationId: ORG_ID, employeeId: EMPLOYEE_ID, actorWallet: MAKER,
    periodGrossPaise: 1_000, periodKind: 'monthly', effectiveFrom: '2025-01-01T00:00:00.000Z', requestId: 'request-2',
  }), /closed or approved period/);
  await assert.rejects(proposeCompensationTerm(mockPool().pool, {
    organizationId: ORG_ID, employeeId: EMPLOYEE_ID, actorWallet: MAKER,
    periodGrossPaise: 1.5, periodKind: 'monthly', effectiveFrom: '2026-11-01T00:00:00.000Z', requestId: 'request-3',
  }), /safe integer/);
  await assert.rejects(proposeCompensationTerm(mockPool({ authorized: false }).pool, {
    organizationId: ORG_ID, employeeId: EMPLOYEE_ID, actorWallet: MAKER,
    periodGrossPaise: 1_000, periodKind: 'monthly', effectiveFrom: '2026-11-01T00:00:00.000Z', requestId: 'request-4',
  }), /operator membership required/);
});

test('requires a different authorized wallet to approve a pending compensation term', async () => {
  const pendingTerm = {
    id: TERM_ID, organization_id: ORG_ID, employee_id: EMPLOYEE_ID,
    period_gross_paise: '8500000', period_kind: 'monthly', effective_from: new Date('2026-11-01T00:00:00.000Z'),
    status: 'pending_approval', prepared_by_wallet: MAKER,
  };
  const { pool, queries } = mockPool({ term: pendingTerm });
  const approved = await approveCompensationTerm(pool, {
    organizationId: ORG_ID, termId: TERM_ID, actorWallet: CHECKER, requestId: 'request-5',
  });
  assert.equal(approved.status, 'approved');
  assert.ok(queries.some(({ sql, values }) => sql.includes('UPDATE compensation_terms') && values.includes(CHECKER)));
  await assert.rejects(approveCompensationTerm(mockPool({ term: pendingTerm }).pool, {
    organizationId: ORG_ID, termId: TERM_ID, actorWallet: MAKER, requestId: 'request-6',
  }), /different wallet/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { closePayrollPeriod, createPayrollPeriod } from '../src/repositories/payrollPeriods.js';

const ORG = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const PERIOD = '03942c34-18d8-4c65-8571-2a15ac32ae17';
const MAKER = `0x${'1'.repeat(40)}`;

function mockPool({ role = true, overlap = false, runApproved = true, unresolvedClaims = 0, endsAt = '2026-10-01T00:00:00.000Z' } = {}) {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [], rowCount: 0 };
      if (normalized.includes('FROM organization_memberships')) return { rows: role ? [{ ok: 1 }] : [], rowCount: role ? 1 : 0 };
      if (normalized.includes('FROM organizations')) return { rows: [{ id: ORG }], rowCount: 1 };
      if (normalized.includes('FROM payroll_periods') && normalized.includes('ends_at >')) return { rows: overlap ? [{ id: PERIOD }] : [], rowCount: overlap ? 1 : 0 };
      if (normalized.includes('FROM payroll_periods') && normalized.includes('FOR UPDATE')) return { rows: [{ id: PERIOD, status: 'approved', ends_at: endsAt }], rowCount: 1 };
      if (normalized.includes('FROM payroll_runs')) return { rows: runApproved ? [{ id: 'run-1' }] : [], rowCount: runApproved ? 1 : 0 };
      if (normalized.includes('FROM claims')) return { rows: unresolvedClaims ? [{ count: unresolvedClaims }] : [], rowCount: unresolvedClaims ? 1 : 0 };
      if (normalized.includes('UPDATE payroll_periods')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, queries };
}

test('creates non-overlapping periods in an active organization under an operator', async () => {
  const { pool, queries } = mockPool();
  const period = await createPayrollPeriod(pool, {
    organizationId: ORG, actorWallet: MAKER, requestId: 'period-1',
    startsAt: '2026-11-01T00:00:00+05:30', endsAt: '2026-12-01T00:00:00+05:30',
  });
  assert.equal(period.status, 'open');
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO payroll_periods')));
  assert.ok(queries.some(({ sql }) => sql.includes('FOR UPDATE')));
  await assert.rejects(createPayrollPeriod(mockPool({ overlap: true }).pool, {
    organizationId: ORG, actorWallet: MAKER, requestId: 'period-2',
    startsAt: '2026-11-15T00:00:00Z', endsAt: '2026-12-15T00:00:00Z',
  }), /overlap/);
});

test('period close requires an approved run and no unresolved claims', async () => {
  await assert.rejects(closePayrollPeriod(mockPool({ runApproved: false }).pool, {
    organizationId: ORG, periodId: PERIOD, actorWallet: MAKER, requestId: 'close-1',
  }), /approved payroll run/);
  await assert.rejects(closePayrollPeriod(mockPool({ unresolvedClaims: 1 }).pool, {
    organizationId: ORG, periodId: PERIOD, actorWallet: MAKER, requestId: 'close-2',
  }), /unresolved claims/);
  const { pool, queries } = mockPool();
  const result = await closePayrollPeriod(pool, {
    organizationId: ORG, periodId: PERIOD, actorWallet: MAKER, requestId: 'close-3',
  });
  assert.equal(result.status, 'closed');
  assert.ok(queries.some(({ sql }) => sql.includes("SET status = 'closed'")));
});

test('period close rejects periods that have not ended and malformed timestamps', async () => {
  await assert.rejects(closePayrollPeriod(mockPool({ endsAt: '2026-12-01T00:00:00.000Z' }).pool, {
    organizationId: ORG, periodId: PERIOD, actorWallet: MAKER, requestId: 'close-future', now: '2026-11-30T23:59:59.999Z',
  }), /has not ended/);
  await assert.rejects(closePayrollPeriod(mockPool({ endsAt: null }).pool, {
    organizationId: ORG, periodId: PERIOD, actorWallet: MAKER, requestId: 'close-invalid',
  }), /ends_at must be a valid timestamp/);
});

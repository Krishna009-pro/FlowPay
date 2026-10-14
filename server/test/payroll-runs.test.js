import test from 'node:test';
import assert from 'node:assert/strict';
import { approvePayrollRun, createPayrollRun, snapshotHash } from '../src/repositories/payrollRuns.js';

const ORG_ID = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const PERIOD_ID = '03942c34-18d8-4c65-8571-2a15ac32ae17';
const RUN_ID = '86c62dcc-723e-4356-bd4e-59b6eb678e07';
const MAKER = `0x${'1'.repeat(40)}`;
const CHECKER = `0x${'2'.repeat(40)}`;

function mockPool({ authorized = true, run = null, periodStatus = 'open' } = {}) {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [], rowCount: 0 };
      if (normalized.includes('FROM organization_memberships')) return { rows: authorized ? [{ ok: 1 }] : [], rowCount: authorized ? 1 : 0 };
      if (normalized.includes('FROM payroll_periods')) return { rows: [{ status: periodStatus }], rowCount: 1 };
      if (normalized.includes('FROM payroll_runs')) return { rows: run ? [run] : [], rowCount: run ? 1 : 0 };
      if (normalized.includes('UPDATE payroll_runs')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, queries };
}

const snapshot = {
  currency: 'INR',
  policy: { version: 'synthetic-v0', status: 'unvalidated' },
  employees: [{ employeeId: 'synthetic-employee-1', grossPaise: 100_000, netPaise: 90_000 }],
};

test('canonical snapshot hash is stable regardless of object insertion order', () => {
  assert.equal(snapshotHash({ a: 1, b: { c: 2 } }), snapshotHash({ b: { c: 2 }, a: 1 }));
});

test('creates a preview snapshot but cannot create one for a closed period', async () => {
  const { pool, queries } = mockPool();
  const result = await createPayrollRun(pool, {
    organizationId: ORG_ID, periodId: PERIOD_ID, actorWallet: MAKER,
    rulesVersion: 'synthetic-v0', snapshot, requestId: 'request-1',
  });
  assert.equal(result.status, 'preview');
  assert.equal(result.rulesStatus, 'unvalidated');
  assert.match(result.snapshotHash, /^[a-f0-9]{64}$/);
  assert.ok(queries.some(({ sql, values }) => sql.includes('INSERT INTO payroll_runs') && values.includes(result.snapshotHash)));
  await assert.rejects(createPayrollRun(mockPool({ periodStatus: 'closed' }).pool, {
    organizationId: ORG_ID, periodId: PERIOD_ID, actorWallet: MAKER,
    rulesVersion: 'synthetic-v0', snapshot, requestId: 'request-2',
  }), /open payroll period/);
});

test('rejects non-JSON snapshots and unsafe numeric values', async () => {
  await assert.rejects(createPayrollRun(mockPool().pool, {
    organizationId: ORG_ID, periodId: PERIOD_ID, actorWallet: MAKER,
    rulesVersion: 'synthetic-v0', snapshot: { amount: 1.25 }, requestId: 'request-3',
  }), /safe integer/);
  const circular = {}; circular.self = circular;
  await assert.rejects(createPayrollRun(mockPool().pool, {
    organizationId: ORG_ID, periodId: PERIOD_ID, actorWallet: MAKER,
    rulesVersion: 'synthetic-v0', snapshot: circular, requestId: 'request-4',
  }), /JSON-compatible/);
});

test('blocks approval without an approved India rules source', async () => {
  const run = {
    id: RUN_ID, status: 'pending_approval', rules_version: 'synthetic-v0',
    snapshot, snapshot_hash: snapshotHash(snapshot), prepared_by_wallet: MAKER,
  };
  await assert.rejects(approvePayrollRun(mockPool({ run }).pool, {
    organizationId: ORG_ID, runId: RUN_ID, actorWallet: CHECKER, requestId: 'request-5',
  }), /approved India payroll rules/);
  const approvedButIncomplete = { async getApprovedVersion(version) { return { jurisdiction: 'IN', version, status: 'approved' }; } };
  await assert.rejects(approvePayrollRun(mockPool({ run }).pool, {
    organizationId: ORG_ID, runId: RUN_ID, actorWallet: CHECKER, requestId: 'request-5b', rulesProvider: approvedButIncomplete,
  }), /cannot validate payroll snapshots/);
});

test('approves the exact snapshot only with distinct maker and checker and matching rules', async () => {
  const run = {
    id: RUN_ID, status: 'pending_approval', rules_version: 'verified-in-v1',
    snapshot, snapshot_hash: snapshotHash(snapshot), prepared_by_wallet: MAKER,
  };
  const rulesProvider = { async getApprovedVersion(version) { return version === 'verified-in-v1' ? {
    jurisdiction: 'IN', version, status: 'approved',
    async validateSnapshot(value, context) {
      assert.equal(context.rulesVersion, version);
      return { status: 'approved', rulesVersion: version, snapshotHash: snapshotHash(value) };
    },
  } : null; } };
  const { pool, queries } = mockPool({ run });
  const result = await approvePayrollRun(pool, {
    organizationId: ORG_ID, runId: RUN_ID, actorWallet: CHECKER, requestId: 'request-6', rulesProvider,
  });
  assert.equal(result.status, 'approved');
  assert.equal(result.approvedByWallet, CHECKER);
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO payroll_approvals')));
  await assert.rejects(approvePayrollRun(mockPool({ run }).pool, {
    organizationId: ORG_ID, runId: RUN_ID, actorWallet: MAKER, requestId: 'request-7', rulesProvider,
  }), /different wallet/);
});

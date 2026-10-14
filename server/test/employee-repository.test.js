import test from 'node:test';
import assert from 'node:assert/strict';
import { approveEmployeeCreation, createEmployee } from '../src/repositories/employee.js';

const ORG_ID = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const EMPLOYEE_ID = '03942c34-18d8-4c65-8571-2a15ac32ae17';
const MAKER = `0x${'1'.repeat(40)}`;
const CHECKER = `0x${'2'.repeat(40)}`;

function mockPool({ authorized = true, employee = null } = {}) {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [], rowCount: 0 };
      if (normalized.includes('FROM organization_memberships')) return { rows: authorized ? [{ ok: 1 }] : [], rowCount: authorized ? 1 : 0 };
      if (normalized.includes('FROM employees')) return { rows: employee ? [employee] : [], rowCount: employee ? 1 : 0 };
      if (normalized.includes('UPDATE employees')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, queries };
}

test('creates employees as pending approval and requires an authorized maker', async () => {
  const { pool, queries } = mockPool();
  const employee = await createEmployee(pool, {
    organizationId: ORG_ID, actorWallet: MAKER, employeeRef: 'synthetic-1',
    displayName: 'Synthetic Employee', requestId: 'employee-1',
  });
  assert.equal(employee.status, 'pending_approval');
  assert.ok(queries.some(({ sql }) => sql.includes("'pending_approval'")));
  await assert.rejects(createEmployee(mockPool({ authorized: false }).pool, {
    organizationId: ORG_ID, actorWallet: MAKER, employeeRef: 'synthetic-2',
    displayName: 'Unauthorized', requestId: 'employee-2',
  }), /operator membership required/);
});

test('only a different active approver activates the employee record', async () => {
  const pending = {
    id: EMPLOYEE_ID, employee_ref: 'synthetic-1', display_name: 'Synthetic Employee',
    wallet_address: null, status: 'pending_approval', prepared_by_wallet: MAKER,
  };
  const { pool, queries } = mockPool({ employee: pending });
  const active = await approveEmployeeCreation(pool, {
    organizationId: ORG_ID, employeeId: EMPLOYEE_ID, actorWallet: CHECKER, requestId: 'employee-approve-1',
  });
  assert.equal(active.status, 'active');
  assert.equal(active.approvedByWallet, CHECKER);
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO employee_approvals')));
  await assert.rejects(approveEmployeeCreation(mockPool({ employee: pending }).pool, {
    organizationId: ORG_ID, employeeId: EMPLOYEE_ID, actorWallet: MAKER, requestId: 'employee-approve-2',
  }), /different wallet/);
  await assert.rejects(approveEmployeeCreation(mockPool({ authorized: false, employee: pending }).pool, {
    organizationId: ORG_ID, employeeId: EMPLOYEE_ID, actorWallet: CHECKER, requestId: 'employee-approve-3',
  }), /approver membership required/);
});

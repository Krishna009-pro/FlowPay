import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { createOrganization } from '../src/repositories/organization.js';
import { approveEmployeeCreation, createEmployee, listEmployees } from '../src/repositories/employee.js';

const { Pool } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test('organization-scoped employee repositories reject cross-tenant reads and writes', {
  skip: !testDatabaseUrl && 'Set TEST_DATABASE_URL to a dedicated disposable PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await runMigrations(pool, new URL('../db/migrations/', import.meta.url));
    const nonce = randomUUID().replaceAll('-', '');
    const walletA = `0x${nonce.slice(0, 40)}`;
    const walletB = `0x${randomUUID().replaceAll('-', '').slice(0, 40)}`;
    const orgA = await createOrganization(pool, { legalName: `Synthetic A ${nonce}`, ownerWallet: walletA, requestId: `test-${nonce}-a` });
    const orgB = await createOrganization(pool, { legalName: `Synthetic B ${nonce}`, ownerWallet: walletB, requestId: `test-${nonce}-b` });
    const employee = await createEmployee(pool, {
      organizationId: orgA.id,
      actorWallet: walletA,
      employeeRef: `synthetic-${nonce}`,
      displayName: 'Synthetic Employee',
      requestId: `test-${nonce}-employee`,
    });
    assert.equal(employee.status, 'pending_approval');
    assert.equal((await listEmployees(pool, { organizationId: orgA.id, actorWallet: walletA })).length, 0);
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, wallet_address, role, status)
       VALUES ($1, $2, 'payroll_approver', 'active')`,
      [orgA.id, walletB],
    );
    await approveEmployeeCreation(pool, {
      organizationId: orgA.id,
      employeeId: employee.id,
      actorWallet: walletB,
      requestId: `test-${nonce}-employee-approval`,
    });

    assert.equal((await listEmployees(pool, { organizationId: orgA.id, actorWallet: walletA })).length, 1);
    await assert.rejects(listEmployees(pool, { organizationId: orgA.id, actorWallet: walletB }), /membership required/);
    await assert.rejects(createEmployee(pool, {
      organizationId: orgA.id,
      actorWallet: walletB,
      employeeRef: `intrusion-${nonce}`,
      displayName: 'Should not be inserted',
      requestId: `test-${nonce}-intrusion`,
    }), /membership required/);
    assert.equal(employee.organizationId, orgA.id);
    assert.notEqual(orgA.id, orgB.id);
  } finally {
    await pool.end();
  }
});

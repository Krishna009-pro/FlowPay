import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from './organization.js';

const OPERATOR_ROLES = ['owner', 'payroll_operator'];

async function requireOperator(client, organizationId, walletAddress) {
  const result = await client.query(
    `SELECT 1 FROM organization_memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = ANY($3::text[])
     FOR SHARE`,
    [organizationId, normalizeWallet(walletAddress), OPERATOR_ROLES],
  );
  if (result.rowCount !== 1) throw new Error('active payroll operator membership required');
}

export async function createEmployee(pool, {
  organizationId,
  actorWallet,
  employeeRef,
  displayName,
  employeeWallet = null,
  requestId,
}) {
  if (typeof employeeRef !== 'string' || employeeRef.trim() === '') throw new TypeError('employeeRef is required');
  if (typeof displayName !== 'string' || displayName.trim() === '') throw new TypeError('displayName is required');
  if (typeof requestId !== 'string' || requestId === '') throw new TypeError('requestId is required');
  const actor = normalizeWallet(actorWallet);
  const linkedWallet = employeeWallet === null ? null : normalizeWallet(employeeWallet);
  const id = randomUUID();

  await withTransaction(pool, async (client) => {
    await requireOperator(client, organizationId, actor);
    await client.query(
      `INSERT INTO employees
       (organization_id, id, employee_ref, display_name, wallet_address, status, prepared_by_wallet)
       VALUES ($1, $2, $3, $4, $5, 'pending_approval', $6)`,
      [organizationId, id, employeeRef.trim(), displayName.trim(), linkedWallet, actor],
    );
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'employee.proposed', 'employee', $4, $5)`,
      [organizationId, randomUUID(), actor, id, requestId],
    );
  });

  return { id, organizationId, employeeRef: employeeRef.trim(), displayName: displayName.trim(), walletAddress: linkedWallet, status: 'pending_approval', preparedByWallet: actor };
}

export async function approveEmployeeCreation(pool, { organizationId, employeeId, actorWallet, requestId }) {
  const actor = normalizeWallet(actorWallet);
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  let employee;
  await withTransaction(pool, async (client) => {
    const approval = await client.query(
      `SELECT 1 FROM organization_memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
         AND o.status = 'active' AND m.role = ANY($3::text[]) FOR SHARE`,
      [organizationId, actor, ['owner', 'payroll_approver']],
    );
    if (approval.rowCount !== 1) throw new Error('active payroll approver membership required');
    const result = await client.query(
      `SELECT id, employee_ref, display_name, wallet_address, status, prepared_by_wallet
       FROM employees WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, employeeId],
    );
    const pending = result.rows[0];
    if (!pending || pending.status !== 'pending_approval') throw new Error('pending employee change not found');
    if (normalizeWallet(pending.prepared_by_wallet) === actor) throw new Error('employee change approval requires a different wallet');
    await client.query(
      `INSERT INTO employee_approvals (organization_id, id, employee_id, actor_wallet, decision)
       VALUES ($1, $2, $3, $4, 'approved')`,
      [organizationId, randomUUID(), employeeId, actor],
    );
    const update = await client.query(
      `UPDATE employees SET status = 'active', approved_by_wallet = $3
       WHERE organization_id = $1 AND id = $2 AND status = 'pending_approval'`,
      [organizationId, employeeId, actor],
    );
    if (update.rowCount !== 1) throw new Error('employee record changed before approval');
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'employee.approved', 'employee', $4, $5)`,
      [organizationId, randomUUID(), actor, employeeId, requestId],
    );
    employee = {
      id: pending.id,
      organizationId,
      employeeRef: pending.employee_ref,
      displayName: pending.display_name,
      walletAddress: pending.wallet_address,
      status: 'active',
      preparedByWallet: normalizeWallet(pending.prepared_by_wallet),
      approvedByWallet: actor,
    };
  });
  return employee;
}

export async function listEmployees(pool, { organizationId, actorWallet }) {
  const actor = normalizeWallet(actorWallet);
  const access = await pool.query(
    `SELECT 1 FROM organization_memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = ANY($3::text[])`,
    [organizationId, actor, ['owner', 'payroll_operator', 'payroll_approver']],
  );
  if (access.rowCount !== 1) throw new Error('active organization membership required');

  const result = await pool.query(
    `SELECT id, employee_ref AS "employeeRef", display_name AS "displayName", status,
            hired_at AS "hiredAt", terminated_at AS "terminatedAt"
     FROM employees WHERE organization_id = $1 ORDER BY employee_ref`,
    [organizationId],
  );
  return result.rows;
}

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from './organization.js';

const OPERATOR_ROLES = ['owner', 'payroll_operator'];
const APPROVER_ROLES = ['owner', 'payroll_approver'];
const PERIOD_KINDS = new Set(['monthly', 'weekly', 'daily', 'custom']);

function validDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} must be a valid timestamp`);
  return date;
}

async function requireRole(client, organizationId, wallet, roles, message) {
  const result = await client.query(
    `SELECT 1 FROM organization_memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = ANY($3::text[]) FOR SHARE`,
    [organizationId, wallet, roles],
  );
  if (result.rowCount !== 1) throw new Error(message);
}

export async function proposeCompensationTerm(pool, {
  organizationId,
  employeeId,
  actorWallet,
  periodGrossPaise,
  periodKind,
  effectiveFrom,
  effectiveTo = null,
  requestId,
}) {
  if (!Number.isSafeInteger(periodGrossPaise) || periodGrossPaise < 0) {
    throw new TypeError('periodGrossPaise must be a non-negative safe integer');
  }
  if (!PERIOD_KINDS.has(periodKind)) throw new TypeError('periodKind is unsupported');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const start = validDate(effectiveFrom, 'effectiveFrom');
  const end = effectiveTo === null ? null : validDate(effectiveTo, 'effectiveTo');
  if (end && end <= start) throw new RangeError('effectiveTo must be after effectiveFrom');
  const actor = normalizeWallet(actorWallet);
  const id = randomUUID();

  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, OPERATOR_ROLES, 'active payroll operator membership required');
    const employee = await client.query(
      `SELECT status FROM employees WHERE organization_id = $1 AND id = $2 FOR SHARE`,
      [organizationId, employeeId],
    );
    if (employee.rowCount !== 1 || employee.rows[0].status !== 'active') throw new Error('active employee not found in organization');

    const closedPeriod = await client.query(
      `SELECT 1 AS exists FROM payroll_periods
       WHERE organization_id = $1 AND status IN ('approved', 'closed') AND ends_at > $2
       LIMIT 1`,
      [organizationId, start],
    );
    if (closedPeriod.rowCount !== 0) throw new Error('compensation cannot be effective inside a closed or approved period');

    await client.query(
      `INSERT INTO compensation_terms
       (organization_id, id, employee_id, period_gross_paise, period_kind, effective_from, effective_to,
        status, prepared_by_wallet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_approval', $8)`,
      [organizationId, id, employeeId, periodGrossPaise, periodKind, start, end, actor],
    );
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id, metadata)
       VALUES ($1, $2, $3, 'compensation.proposed', 'compensation_term', $4, $5,
         jsonb_build_object('periodKind', $6, 'currency', 'INR'))`,
      [organizationId, randomUUID(), actor, id, requestId, periodKind],
    );
  });

  return {
    id,
    organizationId,
    employeeId,
    periodGrossPaise,
    currency: 'INR',
    periodKind,
    effectiveFrom: start.toISOString(),
    effectiveTo: end?.toISOString() ?? null,
    status: 'pending_approval',
    preparedByWallet: actor,
  };
}

export async function approveCompensationTerm(pool, { organizationId, termId, actorWallet, requestId }) {
  const actor = normalizeWallet(actorWallet);
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  let approved;

  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, APPROVER_ROLES, 'active payroll approver membership required');
    const result = await client.query(
      `SELECT id, organization_id, employee_id, period_gross_paise, period_kind, effective_from,
              effective_to, status, prepared_by_wallet
       FROM compensation_terms WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, termId],
    );
    const term = result.rows[0];
    if (!term || term.status !== 'pending_approval') throw new Error('pending compensation term not found');
    if (normalizeWallet(term.prepared_by_wallet) === actor) throw new Error('compensation approval requires a different wallet');

    const closedPeriod = await client.query(
      `SELECT 1 AS exists FROM payroll_periods
       WHERE organization_id = $1 AND status IN ('approved', 'closed') AND ends_at > $2 LIMIT 1`,
      [organizationId, term.effective_from],
    );
    if (closedPeriod.rowCount !== 0) throw new Error('compensation cannot be effective inside a closed or approved period');

    const update = await client.query(
      `UPDATE compensation_terms SET status = 'approved', approved_by_wallet = $3
       WHERE organization_id = $1 AND id = $2 AND status = 'pending_approval'`,
      [organizationId, termId, actor],
    );
    if (update.rowCount !== 1) throw new Error('compensation term changed before approval');
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'compensation.approved', 'compensation_term', $4, $5)`,
      [organizationId, randomUUID(), actor, termId, requestId],
    );
    approved = {
      id: term.id,
      organizationId,
      employeeId: term.employee_id,
      periodGrossPaise: Number(term.period_gross_paise),
      periodKind: term.period_kind,
      effectiveFrom: new Date(term.effective_from).toISOString(),
      effectiveTo: term.effective_to ? new Date(term.effective_to).toISOString() : null,
      status: 'approved',
      preparedByWallet: normalizeWallet(term.prepared_by_wallet),
      approvedByWallet: actor,
    };
  });
  return approved;
}

export async function listCompensationTerms(pool, { organizationId, employeeId, actorWallet }) {
  const actor = normalizeWallet(actorWallet);
  const access = await pool.query(
    `SELECT 1 FROM organization_memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = ANY($3::text[])`,
    [organizationId, actor, [...OPERATOR_ROLES, ...APPROVER_ROLES]],
  );
  if (access.rowCount !== 1) throw new Error('active organization membership required');
  const result = await pool.query(
    `SELECT id, period_gross_paise AS "periodGrossPaise", currency, period_kind AS "periodKind",
            effective_from AS "effectiveFrom", effective_to AS "effectiveTo", status,
            prepared_by_wallet AS "preparedByWallet", approved_by_wallet AS "approvedByWallet"
     FROM compensation_terms WHERE organization_id = $1 AND employee_id = $2 ORDER BY effective_from, id`,
    [organizationId, employeeId],
  );
  return result.rows;
}

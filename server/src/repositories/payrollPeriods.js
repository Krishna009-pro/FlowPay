import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from './organization.js';

const OPERATOR_ROLES = ['owner', 'payroll_operator'];
const APPROVER_ROLES = ['owner', 'payroll_approver'];

function timestamp(value, label) {
  if (value === null || value === undefined || value === '') throw new TypeError(`${label} must be a valid timestamp`);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} must be a valid timestamp`);
  return date;
}

async function requireRole(client, organizationId, wallet, roles, message) {
  const result = await client.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = ANY($3::text[]) FOR SHARE`,
    [organizationId, wallet, roles],
  );
  if (result.rowCount !== 1) throw new Error(message);
}

export async function createPayrollPeriod(pool, { organizationId, actorWallet, requestId, startsAt, endsAt }) {
  const start = timestamp(startsAt, 'startsAt');
  const end = timestamp(endsAt, 'endsAt');
  if (end <= start) throw new RangeError('endsAt must be after startsAt');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const actor = normalizeWallet(actorWallet);
  const id = randomUUID();

  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, OPERATOR_ROLES, 'active payroll operator membership required');
    const organization = await client.query(
      `SELECT id FROM organizations WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [organizationId],
    );
    if (organization.rowCount !== 1) throw new Error('active organization not found');
    const overlaps = await client.query(
      `SELECT id FROM payroll_periods
       WHERE organization_id = $1 AND starts_at < $3 AND ends_at > $2
       FOR UPDATE`,
      [organizationId, start, end],
    );
    if (overlaps.rowCount > 0) throw new Error('payroll period overlaps an existing period');
    await client.query(
      `INSERT INTO payroll_periods (organization_id, id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'open')`,
      [organizationId, id, start, end],
    );
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'payroll_period.created', 'payroll_period', $4, $5)`,
      [organizationId, randomUUID(), actor, id, requestId],
    );
  });
  return { id, organizationId, startsAt: start.toISOString(), endsAt: end.toISOString(), status: 'open' };
}

export async function closePayrollPeriod(pool, { organizationId, periodId, actorWallet, requestId, now = new Date() }) {
  const actor = normalizeWallet(actorWallet);
  const at = timestamp(now, 'now');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  let closed;
  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, APPROVER_ROLES, 'active payroll approver membership required');
    const periodResult = await client.query(
      `SELECT id, status, ends_at FROM payroll_periods
       WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, periodId],
    );
    const period = periodResult.rows[0];
    if (!period || !['open', 'approved'].includes(period.status)) throw new Error('open payroll period not found');
    if (timestamp(period.ends_at, 'ends_at') > at) throw new Error('payroll period has not ended');

    const run = await client.query(
      `SELECT id FROM payroll_runs WHERE organization_id = $1 AND period_id = $2 AND status = 'approved' LIMIT 1`,
      [organizationId, periodId],
    );
    if (run.rowCount !== 1) throw new Error('period close requires an approved payroll run');
    const unresolved = await client.query(
      `SELECT count(*)::int AS count FROM claims
       WHERE organization_id = $1 AND period_id = $2
         AND state NOT IN ('paid', 'failed', 'returned', 'reversed', 'rejected')`,
      [organizationId, periodId],
    );
    if (Number(unresolved.rows[0]?.count ?? 0) !== 0) throw new Error('period close is blocked by unresolved claims');

    const update = await client.query(
      `UPDATE payroll_periods SET status = 'closed' WHERE organization_id = $1 AND id = $2 AND status IN ('open', 'approved')`,
      [organizationId, periodId],
    );
    if (update.rowCount !== 1) throw new Error('payroll period changed before close');
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'payroll_period.closed', 'payroll_period', $4, $5)`,
      [organizationId, randomUUID(), actor, periodId, requestId],
    );
    closed = { id: periodId, status: 'closed' };
  });
  return closed;
}

export async function listPayrollPeriods(pool, { organizationId, actorWallet }) {
  const actor = normalizeWallet(actorWallet);
  const access = await pool.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active' AND o.status = 'active'
       AND m.role = ANY($3::text[])`,
    [organizationId, actor, [...OPERATOR_ROLES, ...APPROVER_ROLES]],
  );
  if (access.rowCount !== 1) throw new Error('active organization membership required');
  const result = await pool.query(
    `SELECT id, starts_at AS "startsAt", ends_at AS "endsAt", status
     FROM payroll_periods WHERE organization_id = $1 ORDER BY starts_at DESC`,
    [organizationId],
  );
  return result.rows;
}

import { createHash, randomUUID } from 'node:crypto';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from './organization.js';

const OPERATOR_ROLES = ['owner', 'payroll_operator'];
const APPROVER_ROLES = ['owner', 'payroll_approver'];

function canonicalize(value, active = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('payroll snapshots may contain only safe integer numeric values');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || value === undefined) throw new TypeError('payroll snapshot must be JSON-compatible');
  if (active.has(value)) throw new TypeError('payroll snapshot must be JSON-compatible and cannot contain cycles');
  active.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonicalize(item, active)).join(',')}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('payroll snapshot must contain plain JSON objects');
    const keys = Object.keys(value).sort();
    result = `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], active)}`).join(',')}}`;
  }
  active.delete(value);
  return result;
}

export function snapshotHash(snapshot) {
  return createHash('sha256').update(canonicalize(snapshot)).digest('hex');
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

export async function createPayrollRun(pool, {
  organizationId,
  periodId,
  actorWallet,
  rulesVersion,
  snapshot,
  requestId,
}) {
  if (typeof rulesVersion !== 'string' || rulesVersion.trim() === '') throw new TypeError('rulesVersion is required');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const snapshotJson = canonicalize(snapshot);
  const parsedSnapshot = JSON.parse(snapshotJson);
  const hash = snapshotHash(parsedSnapshot);
  const actor = normalizeWallet(actorWallet);
  const id = randomUUID();

  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, OPERATOR_ROLES, 'active payroll operator membership required');
    const period = await client.query(
      `SELECT status FROM payroll_periods WHERE organization_id = $1 AND id = $2 FOR SHARE`,
      [organizationId, periodId],
    );
    if (period.rowCount !== 1 || period.rows[0].status !== 'open') throw new Error('open payroll period not found in organization');
    await client.query(
      `INSERT INTO payroll_runs
       (organization_id, id, period_id, status, rules_version, snapshot, snapshot_hash, prepared_by_wallet)
       VALUES ($1, $2, $3, 'preview', $4, $5::jsonb, $6, $7)`,
      [organizationId, id, periodId, rulesVersion.trim(), snapshotJson, hash, actor],
    );
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id, snapshot_ref)
       VALUES ($1, $2, $3, 'payroll_run.previewed', 'payroll_run', $4, $5, $6)`,
      [organizationId, randomUUID(), actor, id, requestId, hash],
    );
  });

  return { id, organizationId, periodId, status: 'preview', rulesVersion: rulesVersion.trim(), rulesStatus: 'unvalidated', snapshot: parsedSnapshot, snapshotHash: hash, preparedByWallet: actor };
}

export async function submitPayrollRun(pool, { organizationId, runId, actorWallet, requestId }) {
  const actor = normalizeWallet(actorWallet);
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  let submitted;
  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, OPERATOR_ROLES, 'active payroll operator membership required');
    const result = await client.query(
      `SELECT id, snapshot_hash, status FROM payroll_runs WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, runId],
    );
    const run = result.rows[0];
    if (!run || run.status !== 'preview') throw new Error('payroll preview not found or already submitted');
    const updated = await client.query(
      `UPDATE payroll_runs SET status = 'pending_approval'
       WHERE organization_id = $1 AND id = $2 AND status = 'preview'`,
      [organizationId, runId],
    );
    if (updated.rowCount !== 1) throw new Error('payroll preview changed before submission');
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id, snapshot_ref)
       VALUES ($1, $2, $3, 'payroll_run.submitted', 'payroll_run', $4, $5, $6)`,
      [organizationId, randomUUID(), actor, runId, requestId, run.snapshot_hash],
    );
    submitted = { id: runId, status: 'pending_approval', snapshotHash: run.snapshot_hash };
  });
  return submitted;
}

export async function approvePayrollRun(pool, {
  organizationId,
  runId,
  actorWallet,
  requestId,
  rulesProvider,
}) {
  const actor = normalizeWallet(actorWallet);
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  let approved;
  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, APPROVER_ROLES, 'active payroll approver membership required');
    const result = await client.query(
      `SELECT id, period_id, status, rules_version, snapshot, snapshot_hash, prepared_by_wallet
       FROM payroll_runs WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, runId],
    );
    const run = result.rows[0];
    if (!run || run.status !== 'pending_approval') throw new Error('pending payroll run not found');
    if (normalizeWallet(run.prepared_by_wallet) === actor) throw new Error('payroll approval requires a different wallet');
    if (snapshotHash(run.snapshot) !== run.snapshot_hash) throw new Error('payroll snapshot hash mismatch');
    if (!rulesProvider || typeof rulesProvider.getApprovedVersion !== 'function') {
      throw new Error('approval blocked: no approved India payroll rules are configured');
    }
    const rules = await rulesProvider.getApprovedVersion(run.rules_version);
    if (!rules || rules.jurisdiction !== 'IN' || rules.version !== run.rules_version || rules.status !== 'approved') {
      throw new Error('approval blocked: an approved India payroll rules version is required');
    }
    if (typeof rules.validateSnapshot !== 'function') {
      throw new Error('approval blocked: India rules source cannot validate payroll snapshots');
    }
    const validation = await rules.validateSnapshot(run.snapshot, {
      organizationId, periodId: run.period_id, rulesVersion: run.rules_version,
    });
    if (validation?.status !== 'approved' || validation.rulesVersion !== run.rules_version
      || validation.snapshotHash !== run.snapshot_hash) {
      throw new Error('approval blocked: India rules source did not validate this exact payroll snapshot');
    }

    const period = await client.query(
      `SELECT status FROM payroll_periods WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [organizationId, run.period_id],
    );
    if (period.rowCount !== 1 || period.rows[0].status === 'closed') throw new Error('payroll period is closed or unavailable');
    const approvalId = randomUUID();
    await client.query(
      `INSERT INTO payroll_approvals
       (organization_id, id, run_id, snapshot_hash, actor_wallet, decision)
       VALUES ($1, $2, $3, $4, $5, 'approved')`,
      [organizationId, approvalId, runId, run.snapshot_hash, actor],
    );
    const updated = await client.query(
      `UPDATE payroll_runs SET status = 'approved', approved_by_wallet = $3, approved_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'pending_approval' AND snapshot_hash = $4`,
      [organizationId, runId, actor, run.snapshot_hash],
    );
    if (updated.rowCount !== 1) throw new Error('payroll snapshot changed before approval');
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id, snapshot_ref)
       VALUES ($1, $2, $3, 'payroll_run.approved', 'payroll_run', $4, $5, $6)`,
      [organizationId, randomUUID(), actor, runId, requestId, run.snapshot_hash],
    );
    approved = { id: runId, status: 'approved', snapshotHash: run.snapshot_hash, approvedByWallet: actor };
  });
  return approved;
}

export async function getPayrollRun(pool, { organizationId, runId, actorWallet }) {
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
    `SELECT id, period_id AS "periodId", status, rules_version AS "rulesVersion", snapshot,
            snapshot_hash AS "snapshotHash", prepared_by_wallet AS "preparedByWallet",
            approved_by_wallet AS "approvedByWallet", created_at AS "createdAt", approved_at AS "approvedAt"
     FROM payroll_runs WHERE organization_id = $1 AND id = $2`,
    [organizationId, runId],
  );
  const run = result.rows[0];
  if (!run) return null;
  return { ...run, rulesStatus: 'unvalidated' };
}

export async function listPayrollRuns(pool, { organizationId, actorWallet }) {
  const actor = normalizeWallet(actorWallet);
  const access = await pool.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = ANY($3::text[])`,
    [organizationId, actor, [...OPERATOR_ROLES, ...APPROVER_ROLES]],
  );
  if (access.rowCount !== 1) throw new Error('active organization membership required');
  const result = await pool.query(
    `SELECT id, period_id AS "periodId", status, rules_version AS "rulesVersion",
            snapshot_hash AS "snapshotHash", prepared_by_wallet AS "preparedByWallet",
            approved_by_wallet AS "approvedByWallet", created_at AS "createdAt", approved_at AS "approvedAt"
     FROM payroll_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [organizationId],
  );
  return result.rows.map((run) => ({ ...run, rulesStatus: 'unvalidated' }));
}

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from './organization.js';

const OPERATOR_ROLES = ['owner', 'payroll_operator'];
const APPROVER_ROLES = ['owner', 'payroll_approver'];

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

function validatePolicy(input) {
  const fields = ['minimumClaimPaise', 'maximumClaimPaise', 'maximumDailyClaims', 'maximumMonthlyClaims', 'autoPayMaximumPaise'];
  for (const field of fields) {
    if (!Number.isSafeInteger(input[field]) || input[field] <= 0) throw new TypeError(`${field} must be a positive safe integer`);
  }
  if (input.minimumClaimPaise > input.maximumClaimPaise) throw new RangeError('minimum claim cannot exceed maximum claim');
  if (input.autoPayMaximumPaise > input.maximumClaimPaise) throw new RangeError('automatic payout maximum cannot exceed maximum claim');
  if (input.maximumMonthlyClaims < input.maximumDailyClaims) throw new RangeError('monthly claim limit cannot be less than the daily limit');
}

function safePaise(value, label) {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(amount)) throw new RangeError(`${label} exceeds the safe integer range in paise`);
  return amount;
}

export async function proposeClaimPolicy(pool, {
  organizationId,
  actorWallet,
  requestId,
  version,
  minimumClaimPaise,
  maximumClaimPaise,
  maximumDailyClaims,
  maximumMonthlyClaims,
  autoPayMaximumPaise,
}) {
  const values = { minimumClaimPaise, maximumClaimPaise, maximumDailyClaims, maximumMonthlyClaims, autoPayMaximumPaise };
  validatePolicy(values);
  if (typeof version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version)) throw new TypeError('policy version is invalid');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const actor = normalizeWallet(actorWallet);
  const id = randomUUID();

  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, OPERATOR_ROLES, 'active payroll operator membership required');
    await client.query(
      `INSERT INTO claim_policies
       (organization_id, id, version, minimum_claim_paise, maximum_claim_paise,
        maximum_daily_claims, maximum_monthly_claims, auto_pay_maximum_paise, status, prepared_by_wallet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_approval', $9)`,
      [organizationId, id, version, minimumClaimPaise, maximumClaimPaise,
        maximumDailyClaims, maximumMonthlyClaims, autoPayMaximumPaise, actor],
    );
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'claim_policy.proposed', 'claim_policy', $4, $5)`,
      [organizationId, randomUUID(), actor, id, requestId],
    );
  });
  return { id, organizationId, version, ...values, status: 'pending_approval', preparedByWallet: actor };
}

export async function approveClaimPolicy(pool, { organizationId, policyId, actorWallet, requestId }) {
  const actor = normalizeWallet(actorWallet);
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  let approved;
  await withTransaction(pool, async (client) => {
    await requireRole(client, organizationId, actor, APPROVER_ROLES, 'active payroll approver membership required');
    const pendingResult = await client.query(
      `SELECT id, version, status, prepared_by_wallet
       FROM claim_policies WHERE organization_id = $1 AND id = $2 AND status = 'pending_approval' FOR UPDATE`,
      [organizationId, policyId],
    );
    const pending = pendingResult.rows[0];
    if (!pending || pending.status !== 'pending_approval') throw new Error('pending claim policy not found');
    if (normalizeWallet(pending.prepared_by_wallet) === actor) throw new Error('claim policy approval requires a different wallet');

    const activeResult = await client.query(
      `SELECT id FROM claim_policies WHERE organization_id = $1 AND status = 'approved' FOR UPDATE`,
      [organizationId],
    );
    for (const active of activeResult.rows) {
      await client.query(
        `UPDATE claim_policies SET status = 'superseded' WHERE organization_id = $1 AND id = $2 AND status = 'approved'`,
        [organizationId, active.id],
      );
    }
    const update = await client.query(
      `UPDATE claim_policies SET status = 'approved', approved_by_wallet = $3, approved_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'pending_approval'`,
      [organizationId, policyId, actor],
    );
    if (update.rowCount !== 1) throw new Error('claim policy changed before approval');
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'claim_policy.approved', 'claim_policy', $4, $5)`,
      [organizationId, randomUUID(), actor, policyId, requestId],
    );
    approved = { id: pending.id, organizationId, version: pending.version, status: 'approved', preparedByWallet: normalizeWallet(pending.prepared_by_wallet), approvedByWallet: actor };
  });
  return approved;
}

export async function getApprovedClaimPolicy(pool, { organizationId, actorWallet }) {
  const actor = normalizeWallet(actorWallet);
  const access = await pool.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active' AND o.status = 'active'
       AND m.role = ANY($3::text[])`,
    [organizationId, actor, ['owner', 'payroll_operator', 'payroll_approver', 'payout_executor']],
  );
  if (access.rowCount !== 1) throw new Error('active organization membership required');
  const result = await pool.query(
    `SELECT version, minimum_claim_paise AS "minimumClaimPaise",
            maximum_claim_paise AS "maximumClaimPaise", maximum_daily_claims AS "maximumDailyClaims",
            maximum_monthly_claims AS "maximumMonthlyClaims", auto_pay_maximum_paise AS "autoPayMaximumPaise"
     FROM claim_policies WHERE organization_id = $1 AND status = 'approved'`,
    [organizationId],
  );
  return result.rows[0] ?? null;
}

export async function listClaimPolicies(pool, { organizationId, actorWallet }) {
  const actor = normalizeWallet(actorWallet);
  const access = await pool.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active' AND o.status = 'active'
       AND m.role = ANY($3::text[])`,
    [organizationId, actor, ['owner', 'payroll_operator', 'payroll_approver', 'payout_executor']],
  );
  if (access.rowCount !== 1) throw new Error('active organization membership required');
  const result = await pool.query(
    `SELECT id, version, minimum_claim_paise AS "minimumClaimPaise",
            maximum_claim_paise AS "maximumClaimPaise", maximum_daily_claims AS "maximumDailyClaims",
            maximum_monthly_claims AS "maximumMonthlyClaims", auto_pay_maximum_paise AS "autoPayMaximumPaise",
            status, prepared_by_wallet AS "preparedByWallet", approved_by_wallet AS "approvedByWallet",
            created_at AS "createdAt", approved_at AS "approvedAt"
     FROM claim_policies WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 25`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    ...row,
    minimumClaimPaise: safePaise(row.minimumClaimPaise, 'minimum claim'),
    maximumClaimPaise: safePaise(row.maximumClaimPaise, 'maximum claim'),
    autoPayMaximumPaise: safePaise(row.autoPayMaximumPaise, 'automatic payout maximum'),
  }));
}

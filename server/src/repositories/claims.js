import { randomUUID } from 'node:crypto';
import { projectLedger } from '../domain/ledger.js';
import { decideClaim } from '../domain/claimPolicy.js';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from './organization.js';

function safeRowAmount(value, label) {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(amount)) throw new RangeError(`${label} exceeds the safe integer range in paise`);
  return amount;
}

function canonicalKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200 || /[\r\n]/.test(value)) {
    throw new TypeError('idempotencyKey must be 8 to 200 printable characters');
  }
  return value;
}

export async function requestEmployeeClaim(pool, {
  organizationId,
  walletAddress,
  requestedPaise,
  idempotencyKey,
  requestId,
  now = new Date(),
}) {
  if (!Number.isSafeInteger(requestedPaise) || requestedPaise <= 0) throw new TypeError('requestedPaise must be positive integer paise');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const wallet = normalizeWallet(walletAddress);
  const key = canonicalKey(idempotencyKey);
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) throw new TypeError('now must be a valid date');
  let response;

  await withTransaction(pool, async (client) => {
    // Locking this tenant-scoped employee serializes all claim reservations for them.
    const employeeResult = await client.query(
      `SELECT id, status FROM employees
       WHERE organization_id = $1 AND wallet_address = $2 AND status = 'active'
       FOR UPDATE`,
      [organizationId, wallet],
    );
    const employee = employeeResult.rows[0];
    if (!employee) throw new Error('active employee wallet is not linked in this organization');
    const employeeId = employee.id;

    const duplicate = await client.query(
      `SELECT id, requested_paise, state, policy_version
       FROM claims WHERE organization_id = $1 AND employee_id = $2 AND idempotency_key = $3`,
      [organizationId, employeeId, key],
    );
    if (duplicate.rows[0]) {
      const existing = duplicate.rows[0];
      if (safeRowAmount(existing.requested_paise, 'requested claim') !== requestedPaise) {
        throw new Error('idempotency key was already used for another claim amount');
      }
      response = {
        id: existing.id,
        organizationId,
        employeeId,
        requestedPaise,
        state: existing.state,
        policyVersion: existing.policy_version,
        decision: existing.state === 'queued' ? 'auto' : 'approval_required',
        idempotentReplay: true,
      };
      return;
    }

    const periodResult = await client.query(
      `SELECT id, status, starts_at, ends_at FROM payroll_periods
       WHERE organization_id = $1 AND status = 'open' AND starts_at <= $2 AND ends_at > $2
       ORDER BY starts_at DESC LIMIT 1 FOR SHARE`,
      [organizationId, at],
    );
    const period = periodResult.rows[0];
    if (!period) throw new Error('no open payroll period is available for a claim');

    const policyResult = await client.query(
      `SELECT version, minimum_claim_paise, maximum_claim_paise, maximum_daily_claims,
              maximum_monthly_claims, auto_pay_maximum_paise
       FROM claim_policies WHERE organization_id = $1 AND status = 'approved'
       FOR SHARE`,
      [organizationId],
    );
    const policyRow = policyResult.rows[0];
    if (!policyRow) throw new Error('an approved claim policy is required');
    const policy = {
      version: policyRow.version,
      minimumClaimPaise: safeRowAmount(policyRow.minimum_claim_paise, 'minimum claim'),
      maximumClaimPaise: safeRowAmount(policyRow.maximum_claim_paise, 'maximum claim'),
      maximumDailyClaims: Number(policyRow.maximum_daily_claims),
      maximumMonthlyClaims: Number(policyRow.maximum_monthly_claims),
      autoPayMaximumPaise: safeRowAmount(policyRow.auto_pay_maximum_paise, 'automatic payout maximum'),
    };
    const countsResult = await client.query(
      `SELECT count(*) FILTER (WHERE c.created_at >=
                date_trunc('day', $3::timestamptz AT TIME ZONE o.payroll_timezone) AT TIME ZONE o.payroll_timezone) AS daily_count,
              count(*) FILTER (WHERE c.created_at >=
                date_trunc('month', $3::timestamptz AT TIME ZONE o.payroll_timezone) AT TIME ZONE o.payroll_timezone) AS monthly_count
       FROM claims c JOIN organizations o ON o.id = c.organization_id
       WHERE c.organization_id = $1 AND c.employee_id = $2`,
      [organizationId, employeeId, at],
    );
    const counts = countsResult.rows[0] ?? { daily_count: 0, monthly_count: 0 };

    const ledgerResult = await client.query(
      `SELECT id, entry_type, amount_paise, idempotency_key, linked_entry_id, created_at
       FROM earning_ledger_entries
       WHERE organization_id = $1 AND employee_id = $2 AND period_id = $3
       ORDER BY effective_at,
         CASE WHEN entry_type IN ('accrual', 'adjustment') THEN 0 ELSE 1 END,
         created_at, id`,
      [organizationId, employeeId, period.id],
    );
    const ledgerKeysById = new Map(ledgerResult.rows.map((row) => [row.id, row.idempotency_key]));
    const ledger = ledgerResult.rows.map((row) => ({
      type: row.entry_type,
      amountPaise: safeRowAmount(row.amount_paise, 'ledger amount'),
      idempotencyKey: row.idempotency_key,
      reservationKey: row.linked_entry_id ? ledgerKeysById.get(row.linked_entry_id) : undefined,
    }));
    const availablePaise = projectLedger(ledger).availablePaise;
    const decision = decideClaim({
      requestedPaise,
      availablePaise,
      dailyClaimCount: Number(counts.daily_count),
      monthlyClaimCount: Number(counts.monthly_count),
      policy,
    });

    const recipientResult = await client.query(
      `SELECT provider_recipient_ref FROM payout_recipient_references
       WHERE organization_id = $1 AND employee_id = $2 AND provider_key = 'fake' AND status = 'verified'
       FOR SHARE`,
      [organizationId, employeeId],
    );
    const recipient = recipientResult.rows[0];
    if (!recipient) throw new Error('a verified payout recipient is required for the fake provider');

    const claimId = randomUUID();
    const state = decision.decision === 'auto' ? 'queued' : 'awaiting_approval';
    const reserveKey = `claim-reservation:${claimId}`;
    await client.query(
      `INSERT INTO claims
       (organization_id, id, employee_id, period_id, requested_paise, reserved_paise,
        policy_version, state, idempotency_key, auto_approval_reason, prepared_by_wallet)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10)`,
      [organizationId, claimId, employeeId, period.id, requestedPaise, policy.version, state, key,
        decision.decision === 'auto' ? 'within_employer_policy' : null, wallet],
    );
    await client.query(
      `INSERT INTO earning_ledger_entries
       (organization_id, id, employee_id, period_id, entry_type, amount_paise, idempotency_key, effective_at, source_ref)
       VALUES ($1, $2, $3, $4, 'reservation', $5, $6, $7, $8)`,
      [organizationId, randomUUID(), employeeId, period.id, requestedPaise, reserveKey, at, claimId],
    );
    if (state === 'queued') {
      const commandKey = `claim-payout:${organizationId}:${claimId}`;
      await client.query(
        `INSERT INTO payout_outbox (id, organization_id, claim_id, command_key, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [randomUUID(), organizationId, claimId, commandKey, JSON.stringify({
          claimId,
          providerKey: 'fake',
          recipientRef: recipient.provider_recipient_ref,
          amountPaise: requestedPaise,
          reservationKey: reserveKey,
        })],
      );
    }
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id, metadata)
       VALUES ($1, $2, $3, 'claim.requested', 'claim', $4, $5,
         jsonb_build_object('state', $6, 'policyVersion', $7, 'decision', $8))`,
      [organizationId, randomUUID(), wallet, claimId, requestId, state, policy.version, decision.decision],
    );
    response = {
      id: claimId,
      organizationId,
      employeeId,
      requestedPaise,
      state,
      policyVersion: policy.version,
      decision: decision.decision,
      reasons: decision.reasons,
      idempotentReplay: false,
    };
  });
  return response;
}

export async function listEmployeeClaims(pool, { organizationId, walletAddress, limit = 50 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit must be an integer from 1 to 100');
  const wallet = normalizeWallet(walletAddress);
  const result = await pool.query(
    `SELECT c.id, c.period_id AS "periodId", c.requested_paise, c.reserved_paise,
            c.state, c.policy_version AS "policyVersion", c.created_at AS "createdAt",
            c.updated_at AS "updatedAt", pa.provider_reference AS "providerReference"
     FROM claims c
     JOIN employees e ON e.organization_id = c.organization_id AND e.id = c.employee_id
     JOIN organizations o ON o.id = c.organization_id
     LEFT JOIN LATERAL (
       SELECT provider_reference FROM payout_attempts p
       WHERE p.organization_id = c.organization_id AND p.claim_id = c.id
       ORDER BY p.created_at DESC LIMIT 1
     ) pa ON true
     WHERE c.organization_id = $1 AND e.wallet_address = $2
       AND e.status = 'active' AND o.status = 'active'
     ORDER BY c.created_at DESC, c.id LIMIT $3`,
    [organizationId, wallet, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    periodId: row.periodId,
    requestedPaise: safeRowAmount(row.requested_paise, 'requested claim'),
    reservedPaise: safeRowAmount(row.reserved_paise, 'reserved claim'),
    state: row.state,
    policyVersion: row.policyVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    providerReference: row.providerReference,
  }));
}

export async function listOrganizationClaims(pool, { organizationId, actorWallet, limit = 100 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError('limit must be an integer from 1 to 200');
  const actor = normalizeWallet(actorWallet);
  const access = await pool.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = ANY($3::text[])`,
    [organizationId, actor, ['owner', 'payroll_operator', 'payroll_approver', 'payout_executor']],
  );
  if (access.rowCount !== 1) throw new Error('active organization membership required');
  const result = await pool.query(
    `SELECT c.id, c.employee_id AS "employeeId", e.employee_ref AS "employeeRef",
            c.period_id AS "periodId", c.requested_paise, c.reserved_paise, c.state,
            c.policy_version AS "policyVersion", c.prepared_by_wallet AS "preparedByWallet",
            c.approved_by_wallet AS "approvedByWallet", c.created_at AS "createdAt",
            c.updated_at AS "updatedAt", pa.provider_reference AS "providerReference"
     FROM claims c
     JOIN employees e ON e.organization_id = c.organization_id AND e.id = c.employee_id
     LEFT JOIN LATERAL (
       SELECT provider_reference FROM payout_attempts p
       WHERE p.organization_id = c.organization_id AND p.claim_id = c.id
       ORDER BY p.created_at DESC LIMIT 1
     ) pa ON true
     WHERE c.organization_id = $1
     ORDER BY c.created_at DESC, c.id LIMIT $2`,
    [organizationId, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employeeRef: row.employeeRef,
    periodId: row.periodId,
    requestedPaise: safeRowAmount(row.requested_paise, 'requested claim'),
    reservedPaise: safeRowAmount(row.reserved_paise, 'reserved claim'),
    state: row.state,
    policyVersion: row.policyVersion,
    preparedByWallet: row.preparedByWallet,
    approvedByWallet: row.approvedByWallet,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    providerReference: row.providerReference,
  }));
}

export async function decideExceptionalClaim(pool, {
  organizationId,
  claimId,
  actorWallet,
  decision,
  requestId,
}) {
  if (!['approve', 'reject'].includes(decision)) throw new TypeError('decision must be approve or reject');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const actor = normalizeWallet(actorWallet);
  let result;

  await withTransaction(pool, async (client) => {
    const role = await client.query(
      `SELECT 1 FROM organization_memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
         AND o.status = 'active' AND m.role = ANY($3::text[]) FOR SHARE`,
      [organizationId, actor, ['owner', 'payroll_approver']],
    );
    if (role.rowCount !== 1) throw new Error('active payroll approver membership required');
    const found = await client.query(
      `SELECT c.id, c.employee_id, c.period_id, c.requested_paise, c.reserved_paise,
              c.state, c.policy_version, c.prepared_by_wallet, e.wallet_address
       FROM claims c JOIN employees e ON e.organization_id = c.organization_id AND e.id = c.employee_id
       WHERE c.organization_id = $1 AND c.id = $2 FOR UPDATE OF c`,
      [organizationId, claimId],
    );
    const claim = found.rows[0];
    if (!claim || claim.state !== 'awaiting_approval') throw new Error('claim awaiting exception approval not found');
    if (claim.prepared_by_wallet && normalizeWallet(claim.prepared_by_wallet) === actor) {
      throw new Error('claim approval requires a different wallet');
    }
    if (claim.wallet_address && normalizeWallet(claim.wallet_address) === actor) {
      throw new Error('employee cannot approve their own claim exception');
    }

    if (decision === 'approve') {
      const recipientResult = await client.query(
        `SELECT provider_recipient_ref FROM payout_recipient_references
         WHERE organization_id = $1 AND employee_id = $2 AND provider_key = 'fake' AND status = 'verified'
         FOR SHARE`,
        [organizationId, claim.employee_id],
      );
      const recipient = recipientResult.rows[0];
      if (!recipient) throw new Error('a verified payout recipient is required for the fake provider');
      const commandKey = `claim-payout:${organizationId}:${claimId}`;
      const reserveKey = `claim-reservation:${claimId}`;
      const updated = await client.query(
        `UPDATE claims SET state = 'queued', approved_by_wallet = $3, updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND state = 'awaiting_approval'`,
        [organizationId, claimId, actor],
      );
      if (updated.rowCount !== 1) throw new Error('claim changed before approval');
      await client.query(
        `INSERT INTO payout_outbox (id, organization_id, claim_id, command_key, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [randomUUID(), organizationId, claimId, commandKey, JSON.stringify({
          claimId, providerKey: 'fake', recipientRef: recipient.provider_recipient_ref,
          amountPaise: safeRowAmount(claim.reserved_paise, 'reserved claim'), reservationKey: reserveKey,
        })],
      );
    } else {
      const reserveKey = `claim-reservation:${claimId}`;
      const reservation = await client.query(
        `SELECT id FROM earning_ledger_entries
         WHERE organization_id = $1 AND idempotency_key = $2 AND entry_type = 'reservation'`,
        [organizationId, reserveKey],
      );
      if (!reservation.rows[0]) throw new Error('claim reservation ledger entry not found');
      await client.query(
        `INSERT INTO earning_ledger_entries
         (organization_id, id, employee_id, period_id, entry_type, amount_paise,
          idempotency_key, effective_at, source_ref, linked_entry_id)
         VALUES ($1, $2, $3, $4, 'reservation_release', $5, $6, now(), $7, $8)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [organizationId, randomUUID(), claim.employee_id, claim.period_id,
          safeRowAmount(claim.reserved_paise, 'reserved claim'), `claim-release:${claimId}`, claimId, reservation.rows[0].id],
      );
      const updated = await client.query(
        `UPDATE claims SET state = 'rejected', reserved_paise = 0, approved_by_wallet = $3, updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND state = 'awaiting_approval'`,
        [organizationId, claimId, actor],
      );
      if (updated.rowCount !== 1) throw new Error('claim changed before rejection');
    }

    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id, metadata)
       VALUES ($1, $2, $3, $4, 'claim', $5, $6, jsonb_build_object('policyVersion', $7))`,
      [organizationId, randomUUID(), actor, decision === 'approve' ? 'claim.approved' : 'claim.rejected', claimId, requestId, claim.policy_version],
    );
    result = { id: claimId, state: decision === 'approve' ? 'queued' : 'rejected', decision };
  });
  return result;
}

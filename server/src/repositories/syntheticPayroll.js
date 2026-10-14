import { createHash, randomUUID } from 'node:crypto';
import { projectEarnings, getIndiaPayrollMonthBounds } from '../domain/earning.js';
import { projectLedger } from '../domain/ledger.js';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from './organization.js';

const OPERATOR_ROLES = ['owner', 'payroll_operator'];

async function requireOperator(client, organizationId, actor) {
  const access = await client.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = ANY($3::text[]) FOR SHARE`,
    [organizationId, actor, OPERATOR_ROLES],
  );
  if (access.rowCount !== 1) throw new Error('active payroll operator membership required');
}

function safePaise(value, label) {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`${label} exceeds the safe integer range in paise`);
  return amount;
}

function safeLedgerAmount(value, label) {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(amount)) throw new RangeError(`${label} exceeds the safe integer range in paise`);
  return amount;
}

function periodKindMatches(kind, start, end) {
  const duration = end.getTime() - start.getTime();
  if (kind === 'custom') return true;
  if (kind === 'daily') return duration === 24 * 60 * 60 * 1000;
  if (kind === 'weekly') return duration === 7 * 24 * 60 * 60 * 1000;
  if (kind === 'monthly') {
    const local = new Date(start.getTime() + 5.5 * 60 * 60 * 1000);
    const { startMs, endMs } = getIndiaPayrollMonthBounds(local.getUTCFullYear(), local.getUTCMonth() + 1);
    return start.getTime() === startMs && end.getTime() === endMs;
  }
  return false;
}

export async function accrueSyntheticEstimate(pool, {
  organizationId, employeeId, periodId, actorWallet, requestId, now = new Date(),
}) {
  const actor = normalizeWallet(actorWallet);
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) throw new TypeError('now must be a valid timestamp');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  let response;
  await withTransaction(pool, async (client) => {
    await requireOperator(client, organizationId, actor);
    const employeeResult = await client.query(
      `SELECT id FROM employees WHERE organization_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
      [organizationId, employeeId],
    );
    if (employeeResult.rowCount !== 1) throw new Error('active employee not found in organization');
    const periodResult = await client.query(
      `SELECT starts_at, ends_at, status FROM payroll_periods
       WHERE organization_id = $1 AND id = $2 FOR SHARE`, [organizationId, periodId],
    );
    const period = periodResult.rows[0];
    if (!period || period.status !== 'open') throw new Error('open payroll period not found in organization');
    const start = new Date(period.starts_at);
    const end = new Date(period.ends_at);
    if (at < start || at >= end) throw new Error('synthetic accrual time must be inside the open payroll period');

    const termsResult = await client.query(
      `SELECT period_gross_paise, period_kind, effective_from, effective_to
       FROM compensation_terms
       WHERE organization_id = $1 AND employee_id = $2 AND status = 'approved'
         AND effective_from < $4 AND (effective_to IS NULL OR effective_to > $3)
       ORDER BY effective_from`,
      [organizationId, employeeId, start, end],
    );
    if (termsResult.rowCount === 0) throw new Error('approved compensation term is required for synthetic accrual');
    const wrongKind = termsResult.rows.find((term) => !periodKindMatches(term.period_kind, start, end));
    if (wrongKind) throw new Error('compensation period type does not match the payroll period; use a matching period or custom');

    const terms = termsResult.rows.map((term) => ({
      periodGrossPaise: safePaise(term.period_gross_paise, 'period gross'),
      effectiveFromMs: new Date(term.effective_from).getTime(),
    }));
    for (let index = 0; index < termsResult.rows.length; index += 1) {
      const effectiveTo = termsResult.rows[index].effective_to && new Date(termsResult.rows[index].effective_to).getTime();
      const nextFrom = terms[index + 1]?.effectiveFromMs;
      if (effectiveTo && effectiveTo <= at.getTime() && effectiveTo < (nextFrom ?? end.getTime())) {
        terms.push({ effectiveFromMs: effectiveTo, periodGrossPaise: 0 });
      }
    }
    const projected = projectEarnings({
      periodStartMs: start.getTime(), periodEndMs: end.getTime(), fromMs: start.getTime(),
      asOfMs: at.getTime(), terms,
    });

    const prior = await client.query(
      `SELECT COALESCE(sum(amount_paise), 0) AS amount
       FROM earning_ledger_entries
       WHERE organization_id = $1 AND employee_id = $2 AND period_id = $3
         AND source_ref = 'synthetic:earning-projection' AND entry_type IN ('accrual', 'adjustment')`,
      [organizationId, employeeId, periodId],
    );
    const previouslyAccrued = safeLedgerAmount(prior.rows[0]?.amount ?? 0, 'synthetic accrued balance');
    const delta = projected.earnedPaise - previouslyAccrued;
    if (delta !== 0) {
      await client.query(
        `INSERT INTO earning_ledger_entries
         (organization_id, id, employee_id, period_id, entry_type, amount_paise,
          idempotency_key, effective_at, source_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'synthetic:earning-projection')`,
        [organizationId, randomUUID(), employeeId, periodId, delta > 0 ? 'accrual' : 'adjustment', delta,
          `synthetic-accrual:${randomUUID()}`, at,],
      );
    }

    const ledgerResult = await client.query(
      `SELECT id, entry_type, amount_paise, idempotency_key, linked_entry_id, created_at
       FROM earning_ledger_entries WHERE organization_id = $1 AND employee_id = $2 AND period_id = $3
       ORDER BY effective_at, CASE WHEN entry_type IN ('accrual', 'adjustment') THEN 0 ELSE 1 END, created_at, id`,
      [organizationId, employeeId, periodId],
    );
    const keyById = new Map(ledgerResult.rows.map((row) => [row.id, row.idempotency_key]));
    const balance = projectLedger(ledgerResult.rows.map((row) => ({
      type: row.entry_type, amountPaise: safeLedgerAmount(row.amount_paise, 'ledger amount'),
      idempotencyKey: row.idempotency_key,
      reservationKey: row.linked_entry_id ? keyById.get(row.linked_entry_id) : undefined,
    })));
    await client.query(
      `INSERT INTO audit_events (organization_id, id, actor_wallet, action, target_type, target_id, request_id, metadata)
       VALUES ($1, $2, $3, 'synthetic.earning_projection', 'employee', $4, $5,
         jsonb_build_object('periodId', $6, 'earnedPaise', $7, 'deltaPaise', $8, 'status', 'estimated'))`,
      [organizationId, randomUUID(), actor, employeeId, requestId, periodId, projected.earnedPaise, delta],
    );
    response = { employeeId, periodId, earnedPaise: projected.earnedPaise, deltaPaise: delta,
      availablePaise: balance.availablePaise, status: 'synthetic_estimate_only' };
  });
  return response;
}

export async function createSyntheticRecipient(pool, { organizationId, employeeId, actorWallet, requestId }) {
  const actor = normalizeWallet(actorWallet);
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const reference = `fake_demo_${createHash('sha256').update(`${organizationId}:${employeeId}`).digest('hex').slice(0, 24)}`;
  let result;
  await withTransaction(pool, async (client) => {
    await requireOperator(client, organizationId, actor);
    const employee = await client.query(
      `SELECT id FROM employees WHERE organization_id = $1 AND id = $2 AND status = 'active' FOR SHARE`,
      [organizationId, employeeId],
    );
    if (employee.rowCount !== 1) throw new Error('active employee not found in organization');
    await client.query(
      `INSERT INTO payout_recipient_references
       (organization_id, id, employee_id, provider_key, provider_recipient_ref, status)
       VALUES ($1, $2, $3, 'fake', $4, 'verified')
       ON CONFLICT (organization_id, employee_id, provider_key) DO UPDATE
         SET provider_recipient_ref = EXCLUDED.provider_recipient_ref, status = 'verified'`,
      [organizationId, randomUUID(), employeeId, reference],
    );
    await client.query(
      `INSERT INTO audit_events (organization_id, id, actor_wallet, action, target_type, target_id, request_id, metadata)
       VALUES ($1, $2, $3, 'synthetic.fake_recipient_created', 'employee', $4, $5,
         jsonb_build_object('provider', 'fake'))`,
      [organizationId, randomUUID(), actor, employeeId, requestId],
    );
    result = { employeeId, providerKey: 'fake', recipientReference: reference, status: 'verified', fake: true };
  });
  return result;
}

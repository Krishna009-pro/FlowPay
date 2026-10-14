import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/transaction.js';
import { nextClaimStateForProvider, normalizeProviderState } from '../domain/payoutTransitions.js';

const FAKE_SYSTEM_WALLET = '0x0000000000000000000000000000000000000001';

function assertFakeProvider(provider) {
  if (!provider || provider.providerKey !== 'fake'
    || typeof provider.createPayout !== 'function'
    || typeof provider.getPayoutStatus !== 'function'
    || typeof provider.verifyWebhook !== 'function') {
    throw new Error('local outbox worker supports the fake payout provider only');
  }
}

function parsePayload(payload) {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!parsed || parsed.providerKey !== 'fake' || typeof parsed.claimId !== 'string'
    || typeof parsed.recipientRef !== 'string' || !Number.isSafeInteger(parsed.amountPaise)
    || typeof parsed.reservationKey !== 'string') {
    throw new Error('invalid fake payout outbox payload');
  }
  return parsed;
}

export async function applyPayoutOutcome(pool, provider, { organizationId, commandKey, outcome, now = new Date() }) {
  assertFakeProvider(provider);
  const providerState = normalizeProviderState(outcome?.state);
  if (outcome?.fake !== true || outcome?.providerKey !== 'fake' || typeof outcome.reference !== 'string') {
    throw new Error('untrusted payout outcome; fake provider evidence required');
  }
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) throw new TypeError('now must be a valid date');
  let result;

  await withTransaction(pool, async (client) => {
    const found = await client.query(
      `SELECT o.id AS outbox_id, o.claim_id, o.payload, c.employee_id, c.period_id,
              c.reserved_paise, c.state AS claim_state, c.idempotency_key AS claim_key
       FROM payout_outbox o JOIN claims c
         ON c.organization_id = o.organization_id AND c.id = o.claim_id
       WHERE o.organization_id = $1 AND o.command_key = $2
       FOR UPDATE OF o, c`,
      [organizationId, commandKey],
    );
    const row = found.rows[0];
    if (!row) throw new Error('payout outbox command not found');
    const payload = parsePayload(row.payload);
    if (payload.claimId !== row.claim_id || payload.amountPaise !== Number(row.reserved_paise)) {
      throw new Error('payout command does not match its reserved claim');
    }
    if (outcome.idempotencyKey !== commandKey || outcome.amountPaise !== payload.amountPaise) {
      throw new Error('payout outcome does not match its idempotent command');
    }
    const claimState = nextClaimStateForProvider(row.claim_state, providerState);
    const reservation = await client.query(
      `SELECT id FROM earning_ledger_entries
       WHERE organization_id = $1 AND idempotency_key = $2 AND entry_type = 'reservation'`,
      [organizationId, payload.reservationKey],
    );
    if (!reservation.rows[0]) throw new Error('claim reservation ledger entry not found');
    const reservationEntryId = reservation.rows[0].id;
    const providerKey = commandKey;
    const evidence = JSON.stringify({ providerKey: 'fake', fake: true, state: providerState, reference: outcome.reference });
    await client.query(
      `INSERT INTO payout_attempts
       (organization_id, id, claim_id, provider_key, provider_idempotency_key,
        provider_reference, state, attempt_number, evidence, updated_at)
       VALUES ($1, $2, $3, 'fake', $4, $5, $6, 1, $7::jsonb, $8)
       ON CONFLICT (organization_id, provider_idempotency_key)
       DO UPDATE SET provider_reference = EXCLUDED.provider_reference,
         state = EXCLUDED.state, evidence = EXCLUDED.evidence, updated_at = EXCLUDED.updated_at`,
      [organizationId, randomUUID(), row.claim_id, providerKey, outcome.reference, providerState, evidence, at],
    );

    if (providerState === 'paid') {
      await client.query(
        `INSERT INTO earning_ledger_entries
         (organization_id, id, employee_id, period_id, entry_type, amount_paise,
          idempotency_key, effective_at, source_ref, linked_entry_id)
         VALUES ($1, $2, $3, $4, 'claim_paid', $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [organizationId, randomUUID(), row.employee_id, row.period_id, Number(row.reserved_paise),
          `claim-paid:${row.claim_id}`, at, outcome.reference, reservationEntryId],
      );
    } else if (providerState === 'failed') {
      await client.query(
        `INSERT INTO earning_ledger_entries
         (organization_id, id, employee_id, period_id, entry_type, amount_paise,
          idempotency_key, effective_at, source_ref, linked_entry_id)
         VALUES ($1, $2, $3, $4, 'reservation_release', $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [organizationId, randomUUID(), row.employee_id, row.period_id, Number(row.reserved_paise),
          `claim-release:${row.claim_id}`, at, outcome.reference, reservationEntryId],
      );
    } else if (['returned', 'reversed'].includes(providerState)) {
      await client.query(
        `INSERT INTO earning_ledger_entries
         (organization_id, id, employee_id, period_id, entry_type, amount_paise,
          idempotency_key, effective_at, source_ref, linked_entry_id)
         VALUES ($1, $2, $3, $4, 'reversal', $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [organizationId, randomUUID(), row.employee_id, row.period_id, Number(row.reserved_paise),
          `claim-reversal:${row.claim_id}:${providerState}`, at, outcome.reference, reservationEntryId],
      );
    }

    await client.query(
      `UPDATE claims SET state = $3, updated_at = $4 WHERE organization_id = $1 AND id = $2`,
      [organizationId, row.claim_id, claimState, at],
    );
    await client.query(
      `UPDATE payout_outbox SET state = $3, locked_by = NULL, lease_expires_at = NULL,
         completed_at = CASE WHEN $3 = 'completed' THEN $4 ELSE completed_at END
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, row.outbox_id, providerState === 'reconciliation_required' ? 'held' : 'completed', at],
    );
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id, metadata)
       SELECT c.organization_id, $2, $7, $3, 'claim', c.id::text, $4,
         jsonb_build_object('provider', 'fake', 'state', $5)
       FROM claims c WHERE c.organization_id = $1 AND c.id = $6`,
      [organizationId, randomUUID(), `payout.${providerState}`, commandKey, providerState, row.claim_id, FAKE_SYSTEM_WALLET],
    );
    result = { claimId: row.claim_id, state: claimState, providerState, fake: true };
  });
  return result;
}

export async function dispatchNextPayout(pool, provider, {
  workerId = randomUUID(),
  organizationId = null,
  now = new Date(),
  leaseSeconds = 60,
} = {}) {
  assertFakeProvider(provider);
  if (typeof workerId !== 'string' || workerId.length === 0) throw new TypeError('workerId is required');
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 300) throw new RangeError('leaseSeconds must be from 5 to 300');
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) throw new TypeError('now must be a valid date');
  if (organizationId !== null && typeof organizationId !== 'string') throw new TypeError('organizationId must be a UUID string');
  let command;

  await withTransaction(pool, async (client) => {
    const organizationClause = organizationId ? 'AND o.organization_id = $2' : '';
    const queryValues = organizationId ? [at, organizationId] : [at];
    const selected = await client.query(
      `SELECT o.id AS outbox_id, o.organization_id, o.claim_id, o.command_key, o.payload
       FROM payout_outbox o
       WHERE o.available_at <= $1 AND (
         o.state = 'pending' OR (o.state = 'processing' AND o.lease_expires_at <= $1)
       ) ${organizationClause}
       ORDER BY o.available_at, o.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      queryValues,
    );
    const row = selected.rows[0];
    if (!row) return;
    const payload = parsePayload(row.payload);
    await client.query(
      `UPDATE payout_outbox SET state = 'processing', locked_by = $2,
         lease_expires_at = $3, attempts = attempts + 1
       WHERE id = $1`,
      [row.outbox_id, workerId, new Date(at.getTime() + leaseSeconds * 1000)],
    );
    await client.query(
      `INSERT INTO payout_attempts
       (organization_id, id, claim_id, provider_key, provider_idempotency_key,
        state, attempt_number, evidence)
       VALUES ($1, $2, $3, 'fake', $4, 'queued', 1, '{"providerKey":"fake","fake":true}'::jsonb)
       ON CONFLICT (organization_id, provider_idempotency_key) DO NOTHING`,
      [row.organization_id, randomUUID(), row.claim_id, row.command_key],
    );
    command = { ...row, payload };
  });

  if (!command) return null;
  let outcome;
  try {
    outcome = await provider.createPayout({
      idempotencyKey: command.command_key,
      amountPaise: command.payload.amountPaise,
      recipientRef: command.payload.recipientRef,
    });
  } catch {
    outcome = await provider.getPayoutStatus(command.command_key);
    if (outcome.state === 'unknown') outcome = {
      providerKey: 'fake', reference: `fake_${command.claim_id}`,
      idempotencyKey: command.command_key, amountPaise: command.payload.amountPaise,
      state: 'reconciliation_required', fake: true,
    };
  }
  const applied = await applyPayoutOutcome(pool, provider, {
    organizationId: command.organization_id,
    commandKey: command.command_key,
    outcome,
    now: at,
  });
  return { ...applied, outboxId: command.outbox_id };
}

export async function reconcileFakePayout(pool, provider, { organizationId, commandKey, now = new Date() }) {
  assertFakeProvider(provider);
  const attempt = await pool.query(
    `SELECT provider_reference FROM payout_attempts
     WHERE organization_id = $1 AND provider_idempotency_key = $2 AND provider_key = 'fake'`,
    [organizationId, commandKey],
  );
  if (!attempt.rows[0]) throw new Error('fake payout attempt not found');
  const outcome = await provider.getPayoutStatus(commandKey);
  if (outcome.state === 'unknown') throw new Error('fake provider outcome remains unknown');
  return applyPayoutOutcome(pool, provider, { organizationId, commandKey, outcome, now });
}

export async function applyFakePayoutWebhook(pool, provider, { organizationId, callback, signature, now = new Date() }) {
  assertFakeProvider(provider);
  if (!provider.verifyWebhook(callback, signature)) throw new Error('fake payout callback signature is invalid');
  const attempt = await pool.query(
    `SELECT provider_reference FROM payout_attempts
     WHERE organization_id = $1 AND provider_idempotency_key = $2 AND provider_key = 'fake'`,
    [organizationId, callback.idempotencyKey],
  );
  if (!attempt.rows[0] || attempt.rows[0].provider_reference !== callback.reference) {
    throw new Error('fake payout callback does not match a recorded attempt');
  }
  const outcome = {
    providerKey: 'fake', fake: true, reference: callback.reference,
    idempotencyKey: callback.idempotencyKey, state: callback.state,
  };
  return applyPayoutOutcome(pool, provider, { organizationId, commandKey: callback.idempotencyKey, outcome, now });
}

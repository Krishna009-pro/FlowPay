import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requestEmployeeClaim } from '../src/repositories/claims.js';
import { runMigrations } from '../src/db/migrate.js';
import { projectLedger } from '../src/domain/ledger.js';
import { FakePayoutProvider } from '../src/payout/fakeProvider.js';
import { applyPayoutOutcome, dispatchNextPayout, reconcileFakePayout } from '../src/payout/outboxWorker.js';

const { Pool } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const wallet = (digit) => `0x${digit.repeat(40)}`;

test('concurrent claims reserve once; fake payouts reconcile idempotently', {
  skip: !testDatabaseUrl && 'Set TEST_DATABASE_URL to a dedicated disposable PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await runMigrations(pool, new URL('../db/migrations/', import.meta.url));
    const organizationId = randomUUID();
    const employeeId = randomUUID();
    const periodId = randomUUID();
    const preparedBy = wallet('1');
    const approvedBy = wallet('2');
    const employeeWallet = wallet('3');
    const now = new Date();

    await pool.query('BEGIN');
    try {
      await pool.query('INSERT INTO organizations (id, legal_name) VALUES ($1, $2)', [organizationId, `Synthetic integration ${organizationId}`]);
      await pool.query(
        `INSERT INTO organization_memberships (organization_id, wallet_address, role, status)
         VALUES ($1, $2, 'owner', 'active'), ($1, $3, 'payroll_approver', 'active')`,
        [organizationId, preparedBy, approvedBy],
      );
      await pool.query(
        `INSERT INTO employees
         (organization_id, id, employee_ref, display_name, wallet_address, status, prepared_by_wallet, approved_by_wallet)
         VALUES ($1, $2, $3, 'Synthetic', $4, 'active', $5, $6)`,
        [organizationId, employeeId, `synthetic-${employeeId}`, employeeWallet, preparedBy, approvedBy],
      );
      await pool.query(
        `INSERT INTO payroll_periods (organization_id, id, starts_at, ends_at, status)
         VALUES ($1, $2, $3, $4, 'open')`,
        [organizationId, periodId, new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000)],
      );
      await pool.query(
        `INSERT INTO claim_policies
         (organization_id, id, version, minimum_claim_paise, maximum_claim_paise, maximum_daily_claims,
          maximum_monthly_claims, auto_pay_maximum_paise, status, prepared_by_wallet, approved_by_wallet, approved_at)
         VALUES ($1, $2, 'test-v1', 100, 100000, 20, 100, 100000, 'approved', $3, $4, now())`,
        [organizationId, randomUUID(), preparedBy, approvedBy],
      );
      await pool.query(
        `INSERT INTO payout_recipient_references
         (organization_id, id, employee_id, provider_key, provider_recipient_ref, status)
         VALUES ($1, $2, $3, 'fake', $4, 'verified')`,
        [organizationId, randomUUID(), employeeId, `fake-${employeeId}`],
      );
      await pool.query(
        `INSERT INTO earning_ledger_entries
         (organization_id, id, employee_id, period_id, entry_type, amount_paise, idempotency_key, effective_at)
         VALUES ($1, $2, $3, $4, 'accrual', 10000, $5, $6)`,
        [organizationId, randomUUID(), employeeId, periodId, `accrual-${employeeId}`, now],
      );
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    const makeClaim = (idempotencyKey) => requestEmployeeClaim(pool, {
      organizationId,
      walletAddress: employeeWallet,
      requestedPaise: 6_000,
      idempotencyKey,
      requestId: `request-${idempotencyKey}`,
      now,
    });
    const concurrent = await Promise.allSettled([makeClaim('claim-concurrent-1'), makeClaim('claim-concurrent-2')]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
    assert.match(concurrent.find((result) => result.status === 'rejected').reason.message, /available balance/);

    const paidProvider = new FakePayoutProvider({ scenario: 'success' });
    const paid = await dispatchNextPayout(pool, paidProvider, { now });
    assert.equal(paid.state, 'paid');
    const commandKey = (await pool.query('SELECT command_key FROM payout_outbox WHERE organization_id = $1', [organizationId])).rows[0].command_key;
    const duplicateEvidence = await paidProvider.createPayout({
      idempotencyKey: commandKey, amountPaise: 6_000, recipientRef: `fake-${employeeId}`,
    });
    await applyPayoutOutcome(pool, paidProvider, { organizationId, commandKey, outcome: duplicateEvidence, now });
    const paidEntries = await pool.query(
      `SELECT count(*)::int AS count FROM earning_ledger_entries
       WHERE organization_id = $1 AND entry_type = 'claim_paid'`,
      [organizationId],
    );
    assert.equal(paidEntries.rows[0].count, 1);
    const balance = await pool.query(
      `SELECT id, entry_type, amount_paise, idempotency_key, linked_entry_id AS reservation_id
       FROM earning_ledger_entries WHERE organization_id = $1 AND employee_id = $2
       ORDER BY effective_at, CASE WHEN entry_type IN ('accrual', 'adjustment') THEN 0 ELSE 1 END, created_at, id`,
      [organizationId, employeeId],
    );
    const keysById = new Map(balance.rows.map((entry) => [entry.id, entry.idempotency_key]));
    assert.equal(projectLedger(balance.rows.map((entry) => ({
      type: entry.entry_type,
      amountPaise: Number(entry.amount_paise),
      idempotencyKey: entry.idempotency_key,
      reservationKey: entry.reservation_id ? keysById.get(entry.reservation_id) : undefined,
    }))).availablePaise, 4_000);

    const secondClaim = await requestEmployeeClaim(pool, {
      organizationId, walletAddress: employeeWallet, requestedPaise: 1_000,
      idempotencyKey: 'claim-timeout', requestId: 'request-timeout', now,
    });
    assert.equal(secondClaim.state, 'queued');
    const timeoutProvider = new FakePayoutProvider({ scenario: 'timeout' });
    const ambiguous = await dispatchNextPayout(pool, timeoutProvider, { now });
    assert.equal(ambiguous.state, 'reconciliation_required');
    assert.equal(timeoutProvider.createCount, 1);
    const timeoutCommand = (await pool.query(
      `SELECT command_key FROM payout_outbox WHERE organization_id = $1 AND claim_id = $2`,
      [organizationId, secondClaim.id],
    )).rows[0].command_key;
    const stillAmbiguous = await reconcileFakePayout(pool, timeoutProvider, { organizationId, commandKey: timeoutCommand, now });
    assert.equal(stillAmbiguous.state, 'reconciliation_required');
    assert.equal(timeoutProvider.createCount, 1);
    assert.equal((await pool.query(
      `SELECT state FROM payout_outbox WHERE organization_id = $1 AND claim_id = $2`,
      [organizationId, secondClaim.id],
    )).rows[0].state, 'held');
  } finally {
    await pool.end();
  }
});

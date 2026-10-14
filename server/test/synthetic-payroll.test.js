import test from 'node:test';
import assert from 'node:assert/strict';
import { accrueSyntheticEstimate, createSyntheticRecipient } from '../src/repositories/syntheticPayroll.js';

const ORG = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const EMPLOYEE = '1be3da75-3599-4192-9c2e-e2c37be0f095';
const PERIOD = '03942c34-18d8-4c65-8571-2a15ac32ae17';
const ACTOR = `0x${'1'.repeat(40)}`;
const START = new Date('2026-09-30T18:30:00.000Z');
const END = new Date('2026-10-31T18:30:00.000Z');
const NOW = new Date('2026-10-14T18:30:00.000Z');

function mockPool({ periodKind = 'monthly', terms = [{ period_gross_paise: '3100000', period_kind: periodKind, effective_from: START, effective_to: null }] } = {}) {
  let currentTerms = terms;
  const entries = [];
  const queries = [];
  const client = { async query(sql, values = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [], rowCount: 0 };
    if (text.includes('FROM organization_memberships')) return { rows: [{ ok: 1 }], rowCount: 1 };
    if (text.includes('FROM employees') && text.startsWith('SELECT id')) return { rows: [{ id: EMPLOYEE }], rowCount: 1 };
    if (text.includes('FROM payroll_periods')) return { rows: [{ starts_at: START, ends_at: END, status: 'open' }], rowCount: 1 };
    if (text.includes('FROM compensation_terms')) return { rows: currentTerms, rowCount: currentTerms.length };
    if (text.includes('COALESCE(sum(amount_paise)')) return { rows: [{ amount: String(entries.reduce((sum, row) => sum + row.amount_paise, 0)) }], rowCount: 1 };
    if (text.includes('INSERT INTO earning_ledger_entries')) {
      entries.push({ id: values[1], entry_type: values[4], amount_paise: values[5], idempotency_key: values[6], linked_entry_id: null, created_at: values[7] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SELECT id, entry_type, amount_paise')) return { rows: entries, rowCount: entries.length };
    if (text.includes('INSERT INTO payout_recipient_references')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  return { pool: { connect: async () => client }, entries, queries, setTerms(next) { currentTerms = next; } };
}

test('synthetic accrual is an estimate, uses approved terms, and updates the ledger idempotently', async () => {
  const { pool, entries } = mockPool();
  const input = { organizationId: ORG, employeeId: EMPLOYEE, periodId: PERIOD, actorWallet: ACTOR, requestId: 'accrue-1', now: NOW };
  const first = await accrueSyntheticEstimate(pool, input);
  assert.equal(first.status, 'synthetic_estimate_only');
  assert.ok(first.earnedPaise > 0);
  assert.equal(first.deltaPaise, first.earnedPaise);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].entry_type, 'accrual');
  const replay = await accrueSyntheticEstimate(pool, { ...input, requestId: 'accrue-2' });
  assert.equal(replay.deltaPaise, 0);
  assert.equal(entries.length, 1);
});

test('retroactive synthetic corrections use negative adjustment entries', async () => {
  const { pool, entries, setTerms } = mockPool();
  const input = { organizationId: ORG, employeeId: EMPLOYEE, periodId: PERIOD, actorWallet: ACTOR, requestId: 'accrue-correction', now: NOW };
  const first = await accrueSyntheticEstimate(pool, input);
  setTerms([{ period_gross_paise: '1000000', period_kind: 'monthly', effective_from: START, effective_to: null }]);
  const corrected = await accrueSyntheticEstimate(pool, { ...input, requestId: 'accrue-correction-2' });
  assert.ok(corrected.deltaPaise < 0);
  assert.equal(entries[1].entry_type, 'adjustment');
  assert.equal(entries[1].amount_paise, corrected.deltaPaise);
  assert.equal(corrected.availablePaise, corrected.earnedPaise);
  assert.equal(corrected.earnedPaise < first.earnedPaise, true);
});

test('synthetic accrual refuses incompatible periods and requires an approved term', async () => {
  await assert.rejects(accrueSyntheticEstimate(mockPool({ periodKind: 'daily' }).pool, {
    organizationId: ORG, employeeId: EMPLOYEE, periodId: PERIOD, actorWallet: ACTOR, requestId: 'accrue-kind', now: NOW,
  }), /does not match/);
  await assert.rejects(accrueSyntheticEstimate(mockPool({ terms: [] }).pool, {
    organizationId: ORG, employeeId: EMPLOYEE, periodId: PERIOD, actorWallet: ACTOR, requestId: 'accrue-no-term', now: NOW,
  }), /approved compensation term/);
});

test('synthetic payout destination contains only a generated fake reference', async () => {
  const { pool, queries } = mockPool();
  const result = await createSyntheticRecipient(pool, { organizationId: ORG, employeeId: EMPLOYEE, actorWallet: ACTOR, requestId: 'recipient-1' });
  assert.equal(result.providerKey, 'fake');
  assert.equal(result.fake, true);
  assert.match(result.recipientReference, /^fake_demo_[a-f0-9]{24}$/);
  const insertion = queries.find(({ text }) => text.includes('INSERT INTO payout_recipient_references'));
  assert.equal(insertion.values[3], result.recipientReference);
});

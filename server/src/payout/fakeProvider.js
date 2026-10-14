import { createHash } from 'node:crypto';

const SCENARIOS = new Set(['success', 'pending', 'timeout', 'failure', 'returned', 'reversed']);

export class FakeAmbiguousPayoutError extends Error {
  constructor() {
    super('fake provider outcome is ambiguous; reconcile before retrying');
    this.name = 'FakeAmbiguousPayoutError';
    this.code = 'FAKE_AMBIGUOUS_TIMEOUT';
  }
}

function stableReference(idempotencyKey) {
  return `fake_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
}

function validatePayout({ idempotencyKey, amountPaise, recipientRef }) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 200) {
    throw new TypeError('fake payout idempotencyKey is required');
  }
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new TypeError('fake payout amount must be positive integer paise');
  }
  if (typeof recipientRef !== 'string' || recipientRef.length === 0) {
    throw new TypeError('fake payout recipient reference is required');
  }
}

/** In-memory synthetic adapter. It never performs network I/O or moves money. */
export class FakePayoutProvider {
  constructor({ scenario = 'success' } = {}) {
    if (!SCENARIOS.has(scenario)) throw new Error('unsupported fake payout scenario');
    this.scenario = scenario;
    this.providerKey = 'fake';
    this.records = new Map();
    this.createCount = 0;
  }

  async createPayout(command) {
    validatePayout(command);
    const previous = this.records.get(command.idempotencyKey);
    if (previous) {
      if (previous.amountPaise !== command.amountPaise || previous.recipientRef !== command.recipientRef) {
        throw new Error('fake provider idempotency key conflicts with prior payout');
      }
      if (previous.state === 'reconciliation_required') throw new FakeAmbiguousPayoutError();
      return { ...previous.result };
    }

    this.createCount += 1;
    const reference = stableReference(command.idempotencyKey);
    let state;
    switch (this.scenario) {
      case 'pending': state = 'submitted'; break;
      case 'timeout': state = 'reconciliation_required'; break;
      case 'failure': state = 'failed'; break;
      default: state = this.scenario === 'success' ? 'paid' : 'paid';
    }
    const result = {
      providerKey: 'fake',
      reference,
      idempotencyKey: command.idempotencyKey,
      amountPaise: command.amountPaise,
      state,
      fake: true,
    };
    this.records.set(command.idempotencyKey, {
      amountPaise: command.amountPaise,
      recipientRef: command.recipientRef,
      state,
      result,
      terminalScenario: this.scenario,
    });
    if (state === 'reconciliation_required') throw new FakeAmbiguousPayoutError();
    return { ...result };
  }

  async getPayoutStatus(idempotencyKey) {
    const record = this.records.get(idempotencyKey);
    if (!record) return { providerKey: 'fake', idempotencyKey, state: 'unknown', fake: true };
    let state = record.state;
    if (record.terminalScenario === 'returned') state = 'returned';
    if (record.terminalScenario === 'reversed') state = 'reversed';
    return { ...record.result, state, fake: true };
  }

  signFakeCallback(callback) {
    return createHash('sha256').update(`flowpay-fake-callback:${JSON.stringify(callback)}`).digest('hex');
  }

  verifyWebhook(callback, signature) {
    if (!callback || typeof callback !== 'object' || typeof signature !== 'string') return false;
    return this.signFakeCallback(callback) === signature;
  }
}

export function createPayoutProvider(providerKey, options = {}) {
  if (providerKey !== 'fake') throw new Error('local payout runner supports the fake provider only');
  return new FakePayoutProvider(options);
}

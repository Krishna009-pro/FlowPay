import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLedger } from '../src/domain/ledger.js';

test('projects available earnings from accrual, adjustments, and active reservations', () => {
  const projection = projectLedger([
    { type: 'accrual', amountPaise: 1000, idempotencyKey: 'accrual-1' },
    { type: 'adjustment', amountPaise: 100, idempotencyKey: 'adjustment-1' },
    { type: 'reservation', amountPaise: 200, idempotencyKey: 'claim-1' },
  ]);
  assert.equal(projection.availablePaise, 900);
  assert.equal(projection.reservedPaise, 200);
});

test('idempotently offsets paid reservations and applies confirmed reversals once', () => {
  const events = [
    { type: 'accrual', amountPaise: 1000, idempotencyKey: 'accrual-1' },
    { type: 'reservation', amountPaise: 250, idempotencyKey: 'claim-1' },
    { type: 'claim_paid', amountPaise: 250, idempotencyKey: 'paid-1', reservationKey: 'claim-1' },
    { type: 'claim_paid', amountPaise: 250, idempotencyKey: 'paid-1', reservationKey: 'claim-1' },
  ];
  assert.equal(projectLedger(events).availablePaise, 750);
  const reversed = [...events, { type: 'reversal', amountPaise: 250, idempotencyKey: 'return-1', reservationKey: 'claim-1' }];
  assert.equal(projectLedger([...reversed, reversed.at(-1)]).availablePaise, 1000);
});

test('releases failed reservations, rejects over-reservation, and detects conflicting retries', () => {
  assert.equal(projectLedger([
    { type: 'accrual', amountPaise: 500, idempotencyKey: 'accrual-1' },
    { type: 'reservation', amountPaise: 200, idempotencyKey: 'claim-1' },
    { type: 'reservation_release', amountPaise: 200, idempotencyKey: 'release-1', reservationKey: 'claim-1' },
  ]).availablePaise, 500);
  assert.throws(() => projectLedger([
    { type: 'accrual', amountPaise: 100, idempotencyKey: 'accrual-1' },
    { type: 'reservation', amountPaise: 101, idempotencyKey: 'claim-1' },
  ]), /insufficient available balance/);
  assert.throws(() => projectLedger([
    { type: 'accrual', amountPaise: 100, idempotencyKey: 'same' },
    { type: 'accrual', amountPaise: 101, idempotencyKey: 'same' },
  ]), /conflicting idempotency key/);
  assert.throws(() => projectLedger([
    { type: 'reservation', amountPaise: 101, idempotencyKey: 'claim-1' },
    { type: 'accrual', amountPaise: 100, idempotencyKey: 'later-accrual' },
  ]), /insufficient available balance/);
});

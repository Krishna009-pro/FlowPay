function validateAmount(entry) {
  if (!Number.isSafeInteger(entry.amountPaise)) throw new TypeError('ledger amount must be a safe integer in paise');
  if (entry.type === 'adjustment') {
    if (entry.amountPaise === 0) throw new RangeError('adjustment amount cannot be zero');
  } else if (entry.amountPaise <= 0) {
    throw new RangeError(`${entry.type} amount must be positive`);
  }
}

function eventFingerprint(entry) {
  return JSON.stringify([entry.type, entry.amountPaise, entry.reservationKey ?? null]);
}

/** Rebuilds a claimable balance from append-only, idempotent ledger events. */
export function projectLedger(entries) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const idempotency = new Map();
  const reservations = new Map();
  let creditsPaise = 0;
  let adjustmentsPaise = 0;
  let paidPaise = 0;
  let reversedPaise = 0;

  const assertAvailable = () => {
    const reserved = [...reservations.values()]
      .filter(({ status }) => status === 'reserved')
      .reduce((sum, { amountPaise }) => sum + amountPaise, 0);
    const available = creditsPaise + adjustmentsPaise - paidPaise + reversedPaise - reserved;
    if (!Number.isSafeInteger(available) || !Number.isSafeInteger(reserved)) {
      throw new RangeError('ledger projection exceeds the safe integer range in paise');
    }
    if (available < 0) throw new Error('insufficient available balance');
  };

  for (const entry of entries) {
    if (!entry || typeof entry.idempotencyKey !== 'string' || entry.idempotencyKey.length === 0) {
      throw new TypeError('every ledger event requires an idempotency key');
    }
    validateAmount(entry);
    const fingerprint = eventFingerprint(entry);
    if (idempotency.has(entry.idempotencyKey)) {
      if (idempotency.get(entry.idempotencyKey) !== fingerprint) throw new Error('conflicting idempotency key');
      continue;
    }
    idempotency.set(entry.idempotencyKey, fingerprint);

    switch (entry.type) {
      case 'accrual':
        creditsPaise += entry.amountPaise;
        break;
      case 'adjustment':
        adjustmentsPaise += entry.amountPaise;
        break;
      case 'reservation':
        if (reservations.has(entry.idempotencyKey)) throw new Error('duplicate reservation');
        reservations.set(entry.idempotencyKey, { amountPaise: entry.amountPaise, status: 'reserved' });
        break;
      case 'reservation_release': {
        const reservation = reservations.get(entry.reservationKey);
        if (!reservation || reservation.status !== 'reserved' || reservation.amountPaise !== entry.amountPaise) {
          throw new Error('reservation release does not match an active reservation');
        }
        reservation.status = 'released';
        break;
      }
      case 'claim_paid': {
        const reservation = reservations.get(entry.reservationKey);
        if (!reservation || reservation.status !== 'reserved' || reservation.amountPaise !== entry.amountPaise) {
          throw new Error('paid claim does not match an active reservation');
        }
        reservation.status = 'paid';
        paidPaise += entry.amountPaise;
        break;
      }
      case 'reversal': {
        const reservation = reservations.get(entry.reservationKey);
        if (!reservation || reservation.status !== 'paid' || reservation.amountPaise !== entry.amountPaise || reservation.reversed) {
          throw new Error('reversal does not match an unreversed paid claim');
        }
        reservation.reversed = true;
        reversedPaise += entry.amountPaise;
        break;
      }
      default:
        throw new Error(`unsupported ledger event type: ${entry.type}`);
    }
    assertAvailable();
  }

  const reservedPaise = [...reservations.values()]
    .filter(({ status }) => status === 'reserved')
    .reduce((sum, { amountPaise }) => sum + amountPaise, 0);
  const grossAvailable = creditsPaise + adjustmentsPaise - paidPaise + reversedPaise;
  const availablePaise = grossAvailable - reservedPaise;
  if (!Number.isSafeInteger(availablePaise) || !Number.isSafeInteger(reservedPaise)) {
    throw new RangeError('ledger projection exceeds the safe integer range in paise');
  }
  if (availablePaise < 0) throw new Error('insufficient available balance');
  return { availablePaise, reservedPaise, paidPaise, reversedPaise };
}

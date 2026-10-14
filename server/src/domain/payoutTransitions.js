const PROVIDER_STATES = new Set(['submitted', 'paid', 'failed', 'returned', 'reversed', 'reconciliation_required']);

export function normalizeProviderState(value) {
  if (!PROVIDER_STATES.has(value)) throw new Error('unsupported payout outcome');
  return value;
}

export function nextClaimStateForProvider(current, next) {
  normalizeProviderState(next);
  if (current === next) return next;
  const allowed = {
    queued: new Set(['submitted', 'paid', 'failed', 'reconciliation_required']),
    submitted: new Set(['paid', 'failed', 'reconciliation_required']),
    reconciliation_required: new Set(['submitted', 'paid', 'failed']),
    paid: new Set(['returned', 'reversed']),
    returned: new Set(),
    reversed: new Set(),
    failed: new Set(),
  };
  if (!allowed[current]?.has(next)) {
    if (['returned', 'reversed'].includes(next) && !['paid', 'returned', 'reversed'].includes(current)) {
      throw new Error('provider return or reversal requires a previously paid claim');
    }
    throw new Error(`invalid payout state transition: ${current} -> ${next}`);
  }
  return next;
}

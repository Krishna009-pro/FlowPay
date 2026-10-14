const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function safeTimestamp(value, label) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer timestamp in milliseconds`);
}

function safePaise(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer in paise`);
}

export function getIndiaPayrollMonthBounds(year, month) {
  if (!Number.isInteger(year) || year < 1970 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('year and month must identify a valid payroll month');
  }
  const startMs = Date.UTC(year, month - 1, 1) - INDIA_OFFSET_MS;
  const endMs = Date.UTC(year, month, 1) - INDIA_OFFSET_MS;
  return { startMs, endMs, timezone: 'Asia/Kolkata' };
}

/**
 * Projects only the interval [fromMs, asOfMs), carrying sub-paise numerator
 * across calls. Terms supersede at their effectiveFromMs. This is an estimate,
 * not a statutory payroll calculation or a record of settled money.
 */
export function projectEarnings({
  periodStartMs,
  periodEndMs,
  fromMs = periodStartMs,
  asOfMs,
  terms,
  previousRemainderNumerator = 0,
}) {
  safeTimestamp(periodStartMs, 'periodStartMs');
  safeTimestamp(periodEndMs, 'periodEndMs');
  safeTimestamp(fromMs, 'fromMs');
  safeTimestamp(asOfMs, 'asOfMs');
  if (periodEndMs <= periodStartMs) throw new RangeError('periodEndMs must be after periodStartMs');
  if (fromMs < periodStartMs || fromMs > periodEndMs) throw new RangeError('fromMs must be within the payroll period');

  const periodDurationMs = periodEndMs - periodStartMs;
  const intervalEndMs = Math.min(Math.max(asOfMs, fromMs), periodEndMs);
  if (!Number.isSafeInteger(previousRemainderNumerator) || previousRemainderNumerator < 0 || previousRemainderNumerator >= periodDurationMs) {
    throw new RangeError('previousRemainderNumerator must be smaller than the payroll period duration');
  }
  if (!Array.isArray(terms)) throw new TypeError('terms must be an array');

  const sorted = terms.map((term) => {
    safeTimestamp(term?.effectiveFromMs, 'term effectiveFromMs');
    safePaise(term?.periodGrossPaise, 'term periodGrossPaise');
    return term;
  }).sort((a, b) => a.effectiveFromMs - b.effectiveFromMs);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].effectiveFromMs === sorted[index].effectiveFromMs) {
      throw new Error('compensation terms cannot share an effective date');
    }
  }

  let active = null;
  let nextIndex = 0;
  while (nextIndex < sorted.length && sorted[nextIndex].effectiveFromMs <= fromMs) {
    active = sorted[nextIndex];
    nextIndex += 1;
  }
  let cursor = fromMs;
  let numerator = BigInt(previousRemainderNumerator);
  while (cursor < intervalEndMs) {
    while (nextIndex < sorted.length && sorted[nextIndex].effectiveFromMs <= cursor) {
      active = sorted[nextIndex];
      nextIndex += 1;
    }
    const nextChangeMs = sorted[nextIndex]?.effectiveFromMs ?? intervalEndMs;
    const segmentEndMs = Math.min(intervalEndMs, nextChangeMs);
    if (!active) {
      if (nextIndex >= sorted.length || sorted[nextIndex].effectiveFromMs > intervalEndMs) {
        throw new Error('no active compensation term at the accrual checkpoint');
      }
      cursor = segmentEndMs;
      continue;
    }
    const elapsedMs = segmentEndMs - cursor;
    numerator += BigInt(active.periodGrossPaise) * BigInt(elapsedMs);
    cursor = segmentEndMs;
  }

  const duration = BigInt(periodDurationMs);
  const earned = numerator / duration;
  if (earned > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('projected earnings exceed the safe integer range in paise');
  return {
    earnedPaise: Number(earned),
    remainderNumerator: Number(numerator % duration),
    asOfMs: intervalEndMs,
    status: 'estimated',
  };
}

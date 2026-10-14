import test from 'node:test';
import assert from 'node:assert/strict';
import { getIndiaPayrollMonthBounds, projectEarnings } from '../src/domain/earning.js';

test('computes India payroll month boundaries in Asia/Kolkata, including leap day', () => {
  const { startMs, endMs } = getIndiaPayrollMonthBounds(2024, 2);
  assert.equal(new Date(startMs).toISOString(), '2024-01-31T18:30:00.000Z');
  assert.equal(new Date(endMs).toISOString(), '2024-02-29T18:30:00.000Z');
});

test('projects a deterministic estimate from active effective-dated terms', () => {
  const result = projectEarnings({
    periodStartMs: 0,
    periodEndMs: 1000,
    asOfMs: 500,
    terms: [{ effectiveFromMs: 0, periodGrossPaise: 1000 }],
  });
  assert.deepEqual(result, { earnedPaise: 500, remainderNumerator: 0, asOfMs: 500, status: 'estimated' });
});

test('checkpoints rate changes without retroactively applying the new compensation', () => {
  const result = projectEarnings({
    periodStartMs: 0,
    periodEndMs: 1000,
    asOfMs: 1000,
    terms: [
      { effectiveFromMs: 0, periodGrossPaise: 1000 },
      { effectiveFromMs: 500, periodGrossPaise: 2000 },
    ],
  });
  assert.equal(result.earnedPaise, 1500);
  assert.equal(result.remainderNumerator, 0);
});

test('carries fractional paise across projection checkpoints and clamps at period end', () => {
  const inputs = { periodStartMs: 0, periodEndMs: 3, terms: [{ effectiveFromMs: 0, periodGrossPaise: 1 }] };
  const first = projectEarnings({ ...inputs, asOfMs: 2 });
  const second = projectEarnings({ ...inputs, fromMs: 2, asOfMs: 3, previousRemainderNumerator: first.remainderNumerator });
  assert.equal(first.earnedPaise, 0);
  assert.equal(first.remainderNumerator, 2);
  assert.equal(second.earnedPaise, 1);
  assert.equal(second.remainderNumerator, 0);
  assert.throws(() => projectEarnings({ ...inputs, asOfMs: 3, terms: [] }), /active compensation/);
  assert.throws(() => projectEarnings({ ...inputs, asOfMs: 3, terms: [
    { effectiveFromMs: 0, periodGrossPaise: 1 }, { effectiveFromMs: 0, periodGrossPaise: 2 },
  ] }), /effective date/);
});

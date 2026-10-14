import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInr, parseInr } from '../src/domain/money.js';

test('parses and formats INR in integer paise without floating point', () => {
  assert.equal(parseInr('0'), 0);
  assert.equal(parseInr('12'), 1200);
  assert.equal(parseInr('12.3'), 1230);
  assert.equal(parseInr('12.34'), 1234);
  assert.equal(formatInr(123456), '₹1,234.56');
  assert.equal(formatInr(0), '₹0.00');
});

test('rejects ambiguous, negative, fractional-paise, and unsafe money inputs', () => {
  for (const invalid of [12.34, ' -1.00', '-1.00', '1.001', '1e3', 'NaN', '', '01.00']) {
    assert.throws(() => parseInr(invalid), { name: 'TypeError' });
  }
  assert.throws(() => parseInr('90071992547409.92'), /safe integer/);
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatInr(invalid), { name: 'TypeError' });
  }
});

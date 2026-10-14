const MAX_SAFE_PAISE = BigInt(Number.MAX_SAFE_INTEGER);
const INR_AMOUNT = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export function parseInr(value) {
  if (typeof value !== 'string') throw new TypeError('INR amount must be a decimal string');
  const match = INR_AMOUNT.exec(value);
  if (!match) throw new TypeError('INR amount must be non-negative with at most two decimal places');

  const rupees = BigInt(match[1]);
  const paise = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  const total = rupees * 100n + paise;
  if (total > MAX_SAFE_PAISE) throw new RangeError('INR amount exceeds the safe integer range in paise');
  return Number(total);
}

export function formatInr(paise) {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new TypeError('paise must be a non-negative safe integer');
  }
  const digits = BigInt(paise).toString().padStart(3, '0');
  const rupees = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₹${rupees}.${digits.slice(-2)}`;
}

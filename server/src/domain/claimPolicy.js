function safePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`);
}

export function decideClaim({ requestedPaise, availablePaise, dailyClaimCount, monthlyClaimCount, policy }) {
  safePositiveInteger(requestedPaise, 'requestedPaise');
  if (!Number.isSafeInteger(availablePaise) || availablePaise < 0) throw new TypeError('availablePaise must be a non-negative safe integer');
  if (!Number.isSafeInteger(dailyClaimCount) || dailyClaimCount < 0 || !Number.isSafeInteger(monthlyClaimCount) || monthlyClaimCount < 0) {
    throw new TypeError('claim counts must be non-negative safe integers');
  }
  if (!policy || typeof policy.version !== 'string' || policy.version.length === 0) throw new TypeError('an approved claim policy is required');
  for (const field of ['minimumClaimPaise', 'maximumClaimPaise', 'maximumDailyClaims', 'maximumMonthlyClaims', 'autoPayMaximumPaise']) {
    safePositiveInteger(policy[field], `policy.${field}`);
  }
  if (policy.minimumClaimPaise > policy.maximumClaimPaise || policy.maximumMonthlyClaims < policy.maximumDailyClaims) {
    throw new RangeError('claim policy limits are inconsistent');
  }
  if (requestedPaise < policy.minimumClaimPaise) throw new RangeError('claim is below the employer policy minimum');
  if (requestedPaise > availablePaise) throw new RangeError('claim exceeds available balance');

  const reasons = [];
  if (requestedPaise > policy.maximumClaimPaise) reasons.push('claim_limit_exceeded');
  if (dailyClaimCount >= policy.maximumDailyClaims) reasons.push('daily_frequency_exceeded');
  if (monthlyClaimCount >= policy.maximumMonthlyClaims) reasons.push('monthly_frequency_exceeded');
  if (requestedPaise > policy.autoPayMaximumPaise) reasons.push('auto_pay_limit_exceeded');
  return {
    decision: reasons.length === 0 ? 'auto' : 'approval_required',
    policyVersion: policy.version,
    reasons,
  };
}

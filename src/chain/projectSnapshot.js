const BPS = 10_000n;

export function projectSnapshot(snapshot, blockTimestamp, nowSeconds, allowProjection = true) {
  if (!snapshot) return null;
  const elapsed = allowProjection ? BigInt(Math.max(0, nowSeconds - blockTimestamp)) : 0n;
  const canAccrue = snapshot.streamCreated && !snapshot.paused && !snapshot.underfunded;
  let newlyVested = canAccrue ? snapshot.ratePerSecond * elapsed : 0n;
  if (newlyVested > snapshot.availableToVest) newlyVested = snapshot.availableToVest;
  const savings = (newlyVested * BigInt(snapshot.savingsRateBps) + snapshot.savingsRemainder) / BPS;
  return {
    totalVested: snapshot.totalVested + newlyVested,
    salaryClaimable: snapshot.salaryClaimable + newlyVested - savings,
    savingsClaimable: snapshot.savingsClaimable + savings,
    availableToVest: snapshot.availableToVest - newlyVested,
  };
}

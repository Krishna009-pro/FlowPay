const snapshotComponents = [
  { name: 'employee', type: 'address' },
  { name: 'ratePerSecond', type: 'uint256' },
  { name: 'totalDeposited', type: 'uint256' },
  { name: 'totalVested', type: 'uint256' },
  { name: 'salaryAccrued', type: 'uint256' },
  { name: 'savingsAccrued', type: 'uint256' },
  { name: 'salaryClaimed', type: 'uint256' },
  { name: 'savingsClaimed', type: 'uint256' },
  { name: 'salaryClaimable', type: 'uint256' },
  { name: 'savingsClaimable', type: 'uint256' },
  { name: 'contractBalance', type: 'uint256' },
  { name: 'availableToVest', type: 'uint256' },
  { name: 'savingsRateBps', type: 'uint16' },
  { name: 'savingsRemainder', type: 'uint256' },
  { name: 'checkpointTime', type: 'uint256' },
  { name: 'streamCreated', type: 'bool' },
  { name: 'paused', type: 'bool' },
  { name: 'underfunded', type: 'bool' },
];

export const FLOWPAY_ABI = [
  { type: 'function', name: 'employer', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'getSnapshot', stateMutability: 'view', inputs: [], outputs: [{ name: 'snapshot', type: 'tuple', components: snapshotComponents }] },
  { type: 'function', name: 'createStream', stateMutability: 'payable', inputs: [{ name: 'employee_', type: 'address' }, { name: 'ratePerSecond_', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'topUp', stateMutability: 'payable', inputs: [], outputs: [] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'resume', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'setSavingsRate', stateMutability: 'nonpayable', inputs: [{ name: 'rateBps', type: 'uint16' }], outputs: [] },
  { type: 'function', name: 'claimSalary', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claimSavings', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'event', name: 'StreamCreated', anonymous: false, inputs: [
    { name: 'employer', type: 'address', indexed: true }, { name: 'employee', type: 'address', indexed: true },
    { name: 'ratePerSecond', type: 'uint256', indexed: false }, { name: 'amount', type: 'uint256', indexed: false },
    { name: 'timestamp', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'ToppedUp', anonymous: false, inputs: [
    { name: 'employer', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false },
    { name: 'totalDeposited', type: 'uint256', indexed: false }, { name: 'timestamp', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'StreamPaused', anonymous: false, inputs: [
    { name: 'employer', type: 'address', indexed: true }, { name: 'timestamp', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'StreamResumed', anonymous: false, inputs: [
    { name: 'employer', type: 'address', indexed: true }, { name: 'timestamp', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'SavingsRateChanged', anonymous: false, inputs: [
    { name: 'employee', type: 'address', indexed: true }, { name: 'oldRateBps', type: 'uint16', indexed: false },
    { name: 'newRateBps', type: 'uint16', indexed: false }, { name: 'timestamp', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'SalaryClaimed', anonymous: false, inputs: [
    { name: 'employee', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false },
    { name: 'timestamp', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'SavingsClaimed', anonymous: false, inputs: [
    { name: 'employee', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false },
    { name: 'timestamp', type: 'uint256', indexed: false },
  ] },
];

export const FLOWPAY_EVENTS = FLOWPAY_ABI.filter((item) => item.type === 'event');

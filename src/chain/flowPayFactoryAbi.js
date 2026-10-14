export const FLOWPAY_FACTORY_ABI = [
  { type: 'function', name: 'createStream', stateMutability: 'payable', inputs: [{ name: 'employee', type: 'address' }, { name: 'ratePerSecond', type: 'uint256' }], outputs: [{ name: 'stream', type: 'address' }] },
  { type: 'function', name: 'registerExistingStream', stateMutability: 'nonpayable', inputs: [{ name: 'stream', type: 'address' }], outputs: [] },
  { type: 'function', name: 'getEmployerStreams', stateMutability: 'view', inputs: [{ name: 'employer', type: 'address' }], outputs: [{ name: '', type: 'address[]' }] },
  { type: 'function', name: 'getEmployeeStreams', stateMutability: 'view', inputs: [{ name: 'employee', type: 'address' }], outputs: [{ name: '', type: 'address[]' }] },
  { type: 'function', name: 'isRegistered', stateMutability: 'view', inputs: [{ name: 'stream', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'event', name: 'StreamCreatedByFactory', anonymous: false, inputs: [
    { name: 'employer', type: 'address', indexed: true }, { name: 'employee', type: 'address', indexed: true }, { name: 'stream', type: 'address', indexed: true },
  ] },
  { type: 'event', name: 'ExistingStreamRegistered', anonymous: false, inputs: [
    { name: 'employer', type: 'address', indexed: true }, { name: 'employee', type: 'address', indexed: true }, { name: 'stream', type: 'address', indexed: true },
  ] },
];

export const FLOWPAY_FACTORY_EVENTS = FLOWPAY_FACTORY_ABI.filter((item) => item.type === 'event');

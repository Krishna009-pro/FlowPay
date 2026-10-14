import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectWallet, getWalletChainId, switchToMonadTestnet } from './flowPay.js';

const account = '0x00000000000000000000000000000000000000a1';
let calls;
let provider;

beforeEach(() => {
  calls = [];
  provider = {
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (method === 'eth_requestAccounts') return [account];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain' && provider.unknownChain) {
        const error = new Error('Unrecognized chain');
        error.code = 4902;
        throw error;
      }
      if (method === 'wallet_addEthereumChain') provider.unknownChain = false;
      return null;
    },
    unknownChain: false,
  };
  globalThis.window = { ethereum: provider };
});

afterEach(() => {
  delete globalThis.window;
});

test('connectWallet requests the active account and reports the connected chain', async () => {
  const wallet = await connectWallet();
  assert.equal(wallet.address.toLowerCase(), account.toLowerCase());
  assert.equal(wallet.chainId, 1);
  assert.deepEqual(calls.map(({ method }) => method), ['eth_requestAccounts', 'eth_chainId']);
});

test('getWalletChainId parses the provider chain id', async () => {
  assert.equal(await getWalletChainId(), 1);
});

test('switchToMonadTestnet requests the configured chain', async () => {
  await switchToMonadTestnet();
  assert.deepEqual(calls, [{ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] }]);
});

test('switchToMonadTestnet adds Monad Testnet when the wallet does not know it', async () => {
  provider.unknownChain = true;
  await switchToMonadTestnet();
  assert.deepEqual(calls.map(({ method }) => method), [
    'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain',
  ]);
  const addRequest = calls[1].params[0];
  assert.equal(addRequest.chainId, '0x279f');
  assert.equal(addRequest.nativeCurrency.symbol, 'MON');
  assert.equal(addRequest.rpcUrls[0], 'https://testnet-rpc.monad.xyz');
});

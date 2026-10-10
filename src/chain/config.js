import { defineChain, getAddress, isAddress } from 'viem';

export const MONAD_CHAIN_ID = 10143;
export const MONAD_RPC_URL = import.meta.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
export const MONADSCAN_TX_URL = (hash) => `https://testnet.monadscan.com/tx/${hash}`;

const configuredChainId = Number(import.meta.env.VITE_MONAD_CHAIN_ID || MONAD_CHAIN_ID);
const rawAddress = (import.meta.env.VITE_FLOWPAY_CONTRACT_ADDRESS || '').trim();
const rawDeploymentBlock = (import.meta.env.VITE_FLOWPAY_DEPLOYMENT_BLOCK || '').trim();

export const FLOWPAY_ADDRESS = isAddress(rawAddress) ? getAddress(rawAddress) : undefined;
export const DEPLOYMENT_BLOCK = /^\d+$/.test(rawDeploymentBlock) ? BigInt(rawDeploymentBlock) : undefined;
export const FLOWPAY_CONFIG_ERROR = configuredChainId !== MONAD_CHAIN_ID
  ? `VITE_MONAD_CHAIN_ID must be ${MONAD_CHAIN_ID}.`
  : rawAddress && !FLOWPAY_ADDRESS
    ? 'VITE_FLOWPAY_CONTRACT_ADDRESS is not a valid EVM address.'
    : undefined;

export const MONAD_TESTNET = defineChain({
  id: MONAD_CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://testnet.monadscan.com' } },
  testnet: true,
});

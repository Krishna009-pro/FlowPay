import { defineChain, getAddress, isAddress } from 'viem';

export const MONAD_CHAIN_ID = 10143;
const env = import.meta.env || {};

export const MONAD_RPC_URL = env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
export const MONADSCAN_TX_URL = (hash) => `https://testnet.monadscan.com/tx/${hash}`;

const configuredChainId = Number(env.VITE_MONAD_CHAIN_ID || MONAD_CHAIN_ID);
const rawAddress = (env.VITE_FLOWPAY_CONTRACT_ADDRESS || '').trim();
const rawDeploymentBlock = (env.VITE_FLOWPAY_DEPLOYMENT_BLOCK || '').trim();
const rawFactoryAddress = (env.VITE_FLOWPAY_FACTORY_ADDRESS || '').trim();
const rawFactoryDeploymentBlock = (env.VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK || '').trim();

export const FLOWPAY_ADDRESS = isAddress(rawAddress) ? getAddress(rawAddress) : undefined;
export const DEPLOYMENT_BLOCK = /^\d+$/.test(rawDeploymentBlock) ? BigInt(rawDeploymentBlock) : undefined;
export const FLOWPAY_FACTORY_ADDRESS = isAddress(rawFactoryAddress) ? getAddress(rawFactoryAddress) : undefined;
export const FLOWPAY_FACTORY_DEPLOYMENT_BLOCK = /^\d+$/.test(rawFactoryDeploymentBlock) ? BigInt(rawFactoryDeploymentBlock) : undefined;
export const MONAD_CONFIG_ERROR = configuredChainId !== MONAD_CHAIN_ID
  ? `VITE_MONAD_CHAIN_ID must be ${MONAD_CHAIN_ID}.`
  : undefined;
export const FLOWPAY_CONFIG_ERROR = rawAddress && !FLOWPAY_ADDRESS
  ? 'VITE_FLOWPAY_CONTRACT_ADDRESS is not a valid EVM address.'
  : undefined;
export const FLOWPAY_FACTORY_CONFIG_ERROR = rawFactoryAddress && !FLOWPAY_FACTORY_ADDRESS
  ? 'VITE_FLOWPAY_FACTORY_ADDRESS is not a valid EVM address.'
  : FLOWPAY_FACTORY_ADDRESS && FLOWPAY_FACTORY_DEPLOYMENT_BLOCK === undefined
    ? 'Set VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK to the confirmed factory deployment block.'
    : !FLOWPAY_FACTORY_ADDRESS && rawFactoryDeploymentBlock
      ? 'VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK is set but VITE_FLOWPAY_FACTORY_ADDRESS is missing.'
      : undefined;

export const MONAD_TESTNET = defineChain({
  id: MONAD_CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://testnet.monadscan.com' } },
  testnet: true,
});

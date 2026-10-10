import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
} from 'viem';
import {
  DEPLOYMENT_BLOCK,
  FLOWPAY_ADDRESS,
  FLOWPAY_CONFIG_ERROR,
  MONAD_RPC_URL,
  MONAD_TESTNET,
} from './config.js';
import { FLOWPAY_ABI, FLOWPAY_EVENTS } from './flowPayAbi.js';

const publicClient = createPublicClient({
  chain: MONAD_TESTNET,
  transport: http(MONAD_RPC_URL),
  pollingInterval: 5_000,
});

let activityScannedThrough;
let activityCache = [];

function requireContractAddress() {
  if (FLOWPAY_CONFIG_ERROR) throw new Error(FLOWPAY_CONFIG_ERROR);
  if (!FLOWPAY_ADDRESS) {
    throw new Error('Add VITE_FLOWPAY_CONTRACT_ADDRESS to .env.local after deploying FlowPay.');
  }
  return FLOWPAY_ADDRESS;
}

function requireEthereum() {
  if (!window.ethereum) throw new Error('Install or open an EIP-1193 wallet such as MetaMask to continue.');
  return window.ethereum;
}

export async function connectWallet() {
  const provider = requireEthereum();
  const walletClient = createWalletClient({ chain: MONAD_TESTNET, transport: custom(provider) });
  const [address] = await walletClient.requestAddresses();
  const chainId = await walletClient.getChainId();
  return { address, walletClient, chainId };
}

export async function getWalletChainId() {
  const provider = requireEthereum();
  const chainIdHex = await provider.request({ method: 'eth_chainId' });
  return Number.parseInt(chainIdHex, 16);
}

export async function switchToMonadTestnet() {
  const provider = requireEthereum();
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x279f',
        chainName: 'Monad Testnet',
        nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
        rpcUrls: [MONAD_RPC_URL],
        blockExplorerUrls: ['https://testnet.monadscan.com'],
      }],
    });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] });
  }
}

export async function readStream() {
  const address = requireContractAddress();
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  const [employer, snapshot] = await Promise.all([
    publicClient.readContract({ address, abi: FLOWPAY_ABI, functionName: 'employer', blockNumber: block.number }),
    publicClient.readContract({ address, abi: FLOWPAY_ABI, functionName: 'getSnapshot', blockNumber: block.number }),
  ]);
  return { employer, snapshot, blockTimestamp: Number(block.timestamp), blockNumber: block.number };
}

export async function readActivity() {
  const address = requireContractAddress();
  if (DEPLOYMENT_BLOCK === undefined) {
    throw new Error('Set VITE_FLOWPAY_DEPLOYMENT_BLOCK to the confirmed deployment block to load history.');
  }

  const latestBlock = await publicClient.getBlockNumber();
  const scanFrom = activityScannedThrough === undefined ? DEPLOYMENT_BLOCK : activityScannedThrough + 1n;
  if (scanFrom > latestBlock) return activityCache;

  const collected = [];
  const chunkSize = 20_000n;
  for (let start = scanFrom; start <= latestBlock; start += chunkSize) {
    const end = start + chunkSize - 1n < latestBlock ? start + chunkSize - 1n : latestBlock;
    const logs = await publicClient.getLogs({
      address,
      events: FLOWPAY_EVENTS,
      fromBlock: start,
      toBlock: end,
    });
    collected.push(...logs);
  }

  const blockNumbers = [...new Set(collected.map((log) => log.blockNumber))];
  const blocks = await Promise.all(blockNumbers.map((blockNumber) => publicClient.getBlock({ blockNumber })));
  const timestamps = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

  const freshActivity = collected
    .sort((left, right) => left.blockNumber === right.blockNumber
      ? Number(left.logIndex - right.logIndex)
      : left.blockNumber < right.blockNumber ? -1 : 1)
    .map((log) => ({
      name: log.eventName,
      args: log.args,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp: timestamps.get(log.blockNumber),
    }));

  activityCache = [...activityCache, ...freshActivity];
  activityScannedThrough = latestBlock;
  return activityCache;
}

export async function submitAction(walletClient, functionName, args = [], value) {
  const address = requireContractAddress();
  const [account] = await walletClient.getAddresses();
  if (!account || !isAddress(account)) throw new Error('Connect a wallet before submitting a transaction.');
  return walletClient.writeContract({
    account,
    address,
    abi: FLOWPAY_ABI,
    functionName,
    args,
    value,
    chain: MONAD_TESTNET,
  });
}

export function waitForAction(hash) {
  return publicClient.waitForTransactionReceipt({ hash });
}

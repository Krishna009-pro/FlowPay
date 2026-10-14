import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  http,
  isAddress,
} from 'viem';
import {
  DEPLOYMENT_BLOCK,
  FLOWPAY_ADDRESS,
  FLOWPAY_FACTORY_ADDRESS,
  FLOWPAY_FACTORY_CONFIG_ERROR,
  FLOWPAY_FACTORY_DEPLOYMENT_BLOCK,
  MONAD_CHAIN_ID,
  MONAD_CONFIG_ERROR,
  MONAD_RPC_URL,
  MONAD_TESTNET,
} from './config.js';
import { FLOWPAY_ABI, FLOWPAY_EVENTS } from './flowPayAbi.js';
import { FLOWPAY_FACTORY_ABI } from './flowPayFactoryAbi.js';

const publicClient = createPublicClient({
  chain: MONAD_TESTNET,
  transport: http(MONAD_RPC_URL),
  pollingInterval: 5_000,
});

const activityCache = new Map();

function requireAddress(address) {
  if (!isAddress(address || '')) throw new Error('A valid FlowPay stream address is required.');
  return address;
}

function requireFactory() {
  if (FLOWPAY_FACTORY_CONFIG_ERROR) throw new Error(FLOWPAY_FACTORY_CONFIG_ERROR);
  if (!FLOWPAY_FACTORY_ADDRESS) throw new Error('Deploy FlowPayFactory on Monad Testnet and configure its public address and deployment block to enable multiple streams.');
  if (FLOWPAY_FACTORY_DEPLOYMENT_BLOCK === undefined) throw new Error('Set the confirmed factory deployment block before loading its streams.');
  return FLOWPAY_FACTORY_ADDRESS;
}

function requireEthereum() {
  if (!window.ethereum) throw new Error('Install or open an EIP-1193 wallet such as MetaMask to continue.');
  return window.ethereum;
}

async function requireFactoryCode() {
  const address = requireFactory();
  const bytecode = await publicClient.getBytecode({ address });
  if (!bytecode || bytecode === '0x') throw new Error('The configured factory address has no contract code on Monad Testnet. Check the address and network.');
  return address;
}

async function walletAccount(walletClient) {
  if (!walletClient) throw new Error('Connect a wallet before submitting a transaction.');
  const chainId = await walletClient.getChainId();
  if (chainId !== MONAD_CHAIN_ID) throw new Error('Switch the connected wallet to Monad Testnet before submitting this transaction.');
  const [account] = await walletClient.getAddresses();
  if (!account || !isAddress(account)) throw new Error('Connect a wallet before submitting a transaction.');
  return account;
}

async function factoryWrite(walletClient, functionName, args = [], value) {
  const factoryAddress = await requireFactoryCode();
  const account = await walletAccount(walletClient);
  return walletClient.writeContract({
    account,
    address: factoryAddress,
    abi: FLOWPAY_FACTORY_ABI,
    functionName,
    args,
    value,
    chain: MONAD_TESTNET,
  });
}

export async function connectWallet() {
  const provider = requireEthereum();
  const walletClient = createWalletClient({ chain: MONAD_TESTNET, transport: custom(provider) });
  const [address] = await walletClient.requestAddresses();
  const chainId = await walletClient.getChainId();
  return { address, walletClient, chainId };
}

export async function getWalletChainId() {
  const chainIdHex = await requireEthereum().request({ method: 'eth_chainId' });
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
        chainId: '0x279f', chainName: 'Monad Testnet',
        nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
        rpcUrls: [MONAD_RPC_URL], blockExplorerUrls: ['https://testnet.monadscan.com'],
      }],
    });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] });
  }
}

export async function readStream(streamAddress) {
  if (MONAD_CONFIG_ERROR) throw new Error(MONAD_CONFIG_ERROR);
  const address = requireAddress(streamAddress);
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  const [employer, snapshot] = await Promise.all([
    publicClient.readContract({ address, abi: FLOWPAY_ABI, functionName: 'employer', blockNumber: block.number }),
    publicClient.readContract({ address, abi: FLOWPAY_ABI, functionName: 'getSnapshot', blockNumber: block.number }),
  ]);
  return { address, employer, snapshot, blockTimestamp: Number(block.timestamp), blockNumber: block.number };
}

export async function readActivity(streamAddress, deploymentBlock) {
  const address = requireAddress(streamAddress);
  if (deploymentBlock === undefined || deploymentBlock === null) {
    throw new Error('The deployment block for this stream is unavailable, so its history cannot be loaded.');
  }
  const key = `${address.toLowerCase()}:${deploymentBlock}`;
  const cached = activityCache.get(key) || { scannedThrough: undefined, entries: [] };
  const latestBlock = await publicClient.getBlockNumber();
  const scanFrom = cached.scannedThrough === undefined ? BigInt(deploymentBlock) : cached.scannedThrough + 1n;
  if (scanFrom > latestBlock) return cached.entries;

  const collected = [];
  const chunkSize = 20_000n;
  for (let start = scanFrom; start <= latestBlock; start += chunkSize) {
    const end = start + chunkSize - 1n < latestBlock ? start + chunkSize - 1n : latestBlock;
    const logs = await publicClient.getLogs({ address, events: FLOWPAY_EVENTS, fromBlock: start, toBlock: end });
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
      name: log.eventName, args: log.args, transactionHash: log.transactionHash,
      blockNumber: log.blockNumber, timestamp: timestamps.get(log.blockNumber),
    }));

  const updated = { scannedThrough: latestBlock, entries: [...cached.entries, ...freshActivity] };
  activityCache.set(key, updated);
  return updated.entries;
}

export async function loadAccountStreams(account) {
  if (!account || !isAddress(account)) return { employerStreams: [], employeeStreams: [] };
  if (FLOWPAY_FACTORY_CONFIG_ERROR) throw new Error(FLOWPAY_FACTORY_CONFIG_ERROR);
  if (!FLOWPAY_FACTORY_ADDRESS) return { employerStreams: [], employeeStreams: [] };
  const factoryAddress = await requireFactoryCode();
  const [employerStreams, employeeStreams] = await Promise.all([
    publicClient.readContract({ address: factoryAddress, abi: FLOWPAY_FACTORY_ABI, functionName: 'getEmployerStreams', args: [account] }),
    publicClient.readContract({ address: factoryAddress, abi: FLOWPAY_FACTORY_ABI, functionName: 'getEmployeeStreams', args: [account] }),
  ]);
  return { employerStreams, employeeStreams };
}

export async function isStreamRegistered(streamAddress) {
  const factoryAddress = await requireFactoryCode();
  return publicClient.readContract({
    address: factoryAddress,
    abi: FLOWPAY_FACTORY_ABI,
    functionName: 'isRegistered',
    args: [requireAddress(streamAddress)],
  });
}

export async function createFactoryStream(walletClient, employee, ratePerSecond, funding, onHash = () => {}) {
  const hash = await factoryWrite(walletClient, 'createStream', [employee, ratePerSecond], funding);
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Factory stream creation reverted. No stream was created.');
  const event = receipt.logs.map((log) => {
    try { return decodeEventLog({ abi: FLOWPAY_FACTORY_ABI, data: log.data, topics: log.topics }); }
    catch { return undefined; }
  }).find((decoded) => decoded?.eventName === 'StreamCreatedByFactory');
  if (!event?.args?.stream) throw new Error('The factory transaction confirmed, but its stream-created event was missing. Refresh the factory list before retrying.');
  return { hash, receipt, streamAddress: event.args.stream };
}

export async function registerLegacyStream(walletClient, legacyAddress, onHash = () => {}) {
  const address = requireAddress(legacyAddress);
  const hash = await factoryWrite(walletClient, 'registerExistingStream', [address]);
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Legacy stream registration reverted.');
  return { hash, receipt, streamAddress: address };
}

export async function submitAction(walletClient, streamAddress, functionName, args = [], value) {
  if (MONAD_CONFIG_ERROR) throw new Error(MONAD_CONFIG_ERROR);
  const address = requireAddress(streamAddress);
  const account = await walletAccount(walletClient);
  return walletClient.writeContract({ account, address, abi: FLOWPAY_ABI, functionName, args, value, chain: MONAD_TESTNET });
}

export function waitForAction(hash) {
  return publicClient.waitForTransactionReceipt({ hash });
}

export const legacyStreamConfiguration = () => ({
  address: FLOWPAY_ADDRESS,
  deploymentBlock: DEPLOYMENT_BLOCK,
});

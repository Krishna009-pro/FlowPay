import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readDeploymentPrivateKey } from './deploymentConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chain = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://testnet.monadscan.com' } },
  testnet: true,
});

async function main() {
  let privateKey;
  try {
    privateKey = readDeploymentPrivateKey();
  } catch {
    throw new Error('PRIVATE_KEY is required in the process environment. Use a dedicated, funded Testnet deployer wallet.');
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ account, chain, transport: http() });
  const chainId = await publicClient.getChainId();
  if (chainId !== 10143) throw new Error(`Refusing deployment: RPC reports chain ${chainId}, expected Monad Testnet 10143.`);

  const artifactPath = path.resolve(__dirname, 'out/FlowPayFactory.json');
  if (!fs.existsSync(artifactPath)) throw new Error('Factory artifact not found. Run node contracts/compile.js first.');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) throw new Error('The deployer has no test MON. Fund it from the official Monad Testnet faucet first.');

  console.log(`Deploying FlowPayFactory on Monad Testnet from ${account.address}.`);
  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: `0x${artifact.bytecode}` });
  console.log(`Transaction: https://testnet.monadscan.com/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Factory deployment did not produce a successful contract receipt.');

  console.log(`Factory address: ${receipt.contractAddress}`);
  console.log(`Deployment block: ${receipt.blockNumber}`);
  console.log(`MonadScan: https://testnet.monadscan.com/address/${receipt.contractAddress}`);
  console.log('After verifying the deployment, configure these public frontend values:');
  console.log(`VITE_FLOWPAY_FACTORY_ADDRESS=${receipt.contractAddress}`);
  console.log(`VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK=${receipt.blockNumber}`);
}

main().catch((error) => {
  console.error(`Factory deployment failed: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});

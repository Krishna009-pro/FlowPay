import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWalletClient, createPublicClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readDeploymentPrivateKey } from './deploymentConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'MonadScan', url: 'https://testnet.monadscan.com' },
  },
});

async function main() {
  let formattedKey;
  try {
    formattedKey = readDeploymentPrivateKey();
  } catch {
    console.log('Error: PRIVATE_KEY is required.');
    console.log('Set PRIVATE_KEY in the process environment using a secure wallet/key-management workflow.');
    process.exit(1);
  }
  const account = privateKeyToAccount(formattedKey);

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(),
  });

  const artifactPath = path.resolve(__dirname, 'out/FlowPay.json');
  if (!fs.existsSync(artifactPath)) {
    console.error('Artifact not found. Please run: node contracts/compile.js');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  console.log(`--------------------------------------------------`);
  console.log(`Deployer Account: ${account.address}`);
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Account Balance : ${(Number(balance) / 1e18).toFixed(4)} MON`);
  console.log(`Target Network  : Monad Testnet (Chain ID 10143)`);
  console.log(`Target Contract : FlowPay.sol`);
  console.log(`--------------------------------------------------`);

  if (balance === 0n) {
    console.error('Error: Insufficient balance. Get testnet MON at https://faucet.monad.xyz');
    process.exit(1);
  }

  console.log('Broadcasting deployment transaction to Monad Testnet...');
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: `0x${artifact.bytecode}`,
  });

  console.log(`Transaction Hash: ${hash}`);
  console.log(`Explorer Link   : https://testnet.monadscan.com/tx/${hash}`);
  console.log('Waiting for Monad block confirmation (~300ms)...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('\n==================================================');
  console.log('🎉 FlowPay DEPLOYED SUCCESSFULLY ON MONAD TESTNET!');
  console.log(`Contract Address: ${receipt.contractAddress}`);
  console.log(`Block Number    : ${receipt.blockNumber}`);
  console.log(`MonadScan Link  : https://testnet.monadscan.com/address/${receipt.contractAddress}`);
  console.log('==================================================\n');

  // Save deployed address artifact
  const deployedInfo = {
    contract: 'FlowPay',
    address: receipt.contractAddress,
    employer: account.address,
    chainId: 10143,
    deploymentBlock: Number(receipt.blockNumber),
    txHash: hash,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.resolve(__dirname, 'out/deployedAddress.json'),
    JSON.stringify(deployedInfo, null, 2)
  );
  console.log('Saved deployment record to: contracts/out/deployedAddress.json');

  console.log('Set these public frontend values manually after verifying the deployment:');
  console.log(`VITE_FLOWPAY_CONTRACT_ADDRESS=${receipt.contractAddress}`);
  console.log(`VITE_FLOWPAY_DEPLOYMENT_BLOCK=${receipt.blockNumber}\n`);
}

main().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});

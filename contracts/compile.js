import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const contractPath = path.resolve(__dirname, 'src/FlowPay.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'FlowPay.sol': {
      content: source,
    },
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode'],
      },
    },
  },
};

console.log('Compiling FlowPay.sol with solc (0.8.28, 200 optimizer runs)...');
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  let hasError = false;
  for (const error of output.errors) {
    console.log(error.formattedMessage);
    if (error.severity === 'error') hasError = true;
  }
  if (hasError) {
    console.error('Compilation failed.');
    process.exit(1);
  }
}

const contract = output.contracts['FlowPay.sol']['FlowPay'];
const artifact = {
  contractName: 'FlowPay',
  abi: contract.abi,
  bytecode: contract.evm.bytecode.object,
};

const outputDir = path.resolve(__dirname, 'out');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(
  path.resolve(outputDir, 'FlowPay.json'),
  JSON.stringify(artifact, null, 2)
);

console.log('✓ Successfully compiled FlowPay.sol!');
console.log(`Bytecode size: ${artifact.bytecode.length / 2} bytes`);
console.log(`Artifact saved to: contracts/out/FlowPay.json`);

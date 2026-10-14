import fs from 'fs';
import path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceNames = ['FlowPayCore.sol', 'FlowPay.sol', 'FlowPayStream.sol', 'FlowPayFactory.sol'];
const sources = Object.fromEntries(sourceNames.map((name) => [name, {
  content: fs.readFileSync(path.resolve(__dirname, 'src', name), 'utf8'),
}]));

const input = {
  language: 'Solidity',
  sources,
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

console.log('Compiling FlowPay contracts with solc (0.8.28, 200 optimizer runs)...');
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

const outputDir = path.resolve(__dirname, 'out');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

for (const [sourceName, contractName] of [
  ['FlowPay.sol', 'FlowPay'],
  ['FlowPayStream.sol', 'FlowPayStream'],
  ['FlowPayFactory.sol', 'FlowPayFactory'],
]) {
  const contract = output.contracts[sourceName][contractName];
  const artifact = {
    contractName,
    abi: contract.abi,
    bytecode: contract.evm.bytecode.object,
  };
  fs.writeFileSync(path.resolve(outputDir, `${contractName}.json`), JSON.stringify(artifact, null, 2));
  console.log(`✓ ${contractName}: ${artifact.bytecode.length / 2} bytes → contracts/out/${contractName}.json`);
}

# Monad Developer Master Reference & AI Context Guide

> **Comprehensive Knowledge Base & Web-Scraped Documentation Compilation**  
> *Curated for developers, AI assistants (ChatGPT/Claude/Codex), and hackathon builders building on the Monad high-throughput EVM.*

---

## 📑 Table of Contents
1. [Official Portals & Quick Links](#1-official-portals--quick-links)
2. [Monad Hackathon & Metropolis Portal](#2-monad-hackathon--metropolis-portal)
3. [Network Specifications & RPC Endpoints](#3-network-specifications--rpc-endpoints)
4. [Monad Architecture & Core Innovations](#4-monad-architecture--core-innovations)
5. [Key EVM Differences & Opcode Details](#5-key-evm-differences--opcode-details)
6. [Tooling Setup: Viem, Foundry & Hardhat](#6-tooling-setup-viem-foundry--hardhat)
7. [Smart Contract Verification](#7-smart-contract-verification)
8. [Data Indexing & Infrastructure](#8-data-indexing--infrastructure)
9. [Smart Contract Implementation Pattern (Salary Streaming)](#9-smart-contract-implementation-pattern-salary-streaming)
10. [AI / ChatGPT System Prompt Template](#10-ai--chatgpt-system-prompt-template)

---

## 1. Official Portals & Quick Links

| Resource | Official URL | Purpose |
| :--- | :--- | :--- |
| **Official Documentation** | [https://docs.monad.xyz](https://docs.monad.xyz) | Developer guides, API specs, deployment summaries |
| **Monad Website** | [https://monad.xyz](https://monad.xyz) | Official homepage, research papers, community |
| **Monad Faucet (MON)** | [https://faucet.monad.xyz](https://faucet.monad.xyz) | Native testnet MON token dispenser |
| **Circle Faucet (USDC)** | [https://faucet.circle.com](https://faucet.circle.com) | Testnet native USDC faucet |
| **Primary Block Explorer** | [https://testnet.monadscan.com](https://testnet.monadscan.com) | Etherscan-style explorer (MonadScan) |
| **Alternative Explorer** | [https://testnet.monadvision.com](https://testnet.monadvision.com) | Real-time block explorer (MonadVision by BlockVision) |
| **Official GitHub** | [https://github.com/monad-labs](https://github.com/monad-labs) | Open-source templates, SDKs, and libraries |
| **Official Twitter / X** | [https://x.com/monad_xyz](https://x.com/monad_xyz) | Announcements, network updates |

---

## 2. Monad Hackathon & Metropolis Portal

* **Hackathon Notion Database:** [Monad Foundation Hackathon Portal](https://monad-foundation.notion.site/3486367594f28050a188f3178fc61735?v=3486367594f281c291a6000cabf5ebd0)
* **Rise In Portal:** [https://risein.com](https://risein.com)

### Metropolis Hackathon Tracks
1. **Consumer Products & Payments**:
   - Frictionless, consumer-grade payment rails.
   - Second-by-second subscriptions, salary micro-streaming, automated savings, shared wallets.
2. **On-chain Finance & Trading**:
   - High-frequency trading, fully on-chain order books (CLOBs), perps with sub-second funding rate updates.
   - Algorithmic liquidity, automated market makers (AMMs), undercollateralized lending.
3. **Social, Attention & Culture**:
   - Real-time social feeds, micro-tipping, decentralized creator networks taking advantage of 300ms feedback loops.
4. **Trust, Identity & AI Infrastructure**:
   - Verifiable agentic workflows, on-chain autonomous agents, zero-knowledge proofs (ZKP), decentralized identity.

---

## 3. Network Specifications & RPC Endpoints

### Monad Testnet Configuration
* **Network Name:** Monad Testnet
* **Chain ID:** `10143` (Hex: `0x279f`)
* **Currency Symbol:** `MON`
* **Decimals:** `18`
* **Block Time:** `300ms` (~0.3 seconds)
* **Finality:** `600ms` (Single-slot / two-round full finality)
* **Target Throughput:** Up to `10,000 TPS`

### RPC Endpoints
```text
# Primary Foundation Endpoints
HTTP RPC:      https://testnet-rpc.monad.xyz
WebSocket:     wss://testnet-rpc.monad.xyz

# Infrastructure Partner RPCs
Ankr:          https://rpc.ankr.com/monad_testnet
MonadInfra:    https://rpc-testnet.monadinfra.com
               wss://rpc-testnet.monadinfra.com
```

### Pre-deployed Core Contracts
* **Multicall3:** `0xcA11bde05977b3631167028862bE2a173976CA11`

---

## 4. Monad Architecture & Core Innovations

Monad is a **Layer-1, 100% EVM-compatible** blockchain that reimagines execution, storage, and consensus from the ground up:

### 1. MonadBFT (Pipelined Consensus)
* Pipelined Byzantine Fault Tolerant consensus engine operating on a 2-round commit mechanism.
* Solves tail-forking and separates consensus from execution: the network orders transactions and reaches consensus *before* executing the block contents.

### 2. Optimistic Parallel Execution
* Traditional Ethereum executes transactions sequentially on a single thread.
* Monad executes transactions optimistically across multiple CPU cores simultaneously.
* It traces state dependencies (read/write sets). If transaction $B$ depends on an output of transaction $A$ that ran concurrently, transaction $B$ is detected as conflicting and automatically re-executed with the updated state.
* **Deterministic Outcome:** The final state is mathematically identical to sequential execution, preserving full EVM correctness without requiring developers to write custom concurrent code.

### 3. Asynchronous / Deferred Execution
* Consensus and execution are decoupled into separate stages in the node pipeline.
* Validators agree on the ordered list of transactions first. Nodes then execute transactions asynchronously, freeing up the entire block interval for compute and throughput.

### 4. MonadDb (Custom Asynchronous State Storage)
* In standard EVM clients (Geth/Erigon), database I/O using LevelDB or Pebble is synchronous and forms the primary performance bottleneck.
* MonadDb implements custom, asynchronous kernel-level SSD storage with native parallel reads and writes, eliminating I/O stalls during transaction execution.

---

## 5. Key EVM Differences & Opcode Details

Monad is fully bytecode-compatible with the Ethereum Virtual Machine (supporting the Fusaka fork). However, developers should note several unique enhancements:

1. **Increased Bytecode Limit**:
   * Ethereum: Contract size limit is `24,576 bytes` (EIP-170).
   * Monad: Max contract code size is expanded to **`128 KB`**, allowing richer monolithic contracts without proxy workarounds.
2. **Storage Page Gas Pricing (Warm vs. Cold)**:
   * Storage slots are clustered into **storage pages** of 128 consecutive slots.
   * Reading or writing adjacent storage slots warms the entire 128-slot page. Subsequent reads/writes within the same page cost the warm rate, dramatically lowering gas for structs and sequential arrays.
3. **Linear Memory Expansion**:
   * Ethereum prices memory expansion quadratically beyond certain thresholds.
   * Monad prices memory expansion linearly, supporting transactions that allocate up to **8 MB** of memory.
4. **Opcode Parity**:
   * All standard EVM opcodes are supported as-is (`CREATE2`, `PUSH0`, `MCOPY`, `TSTORE`, `TLOAD`).

---

## 6. Tooling Setup: Viem, Foundry & Hardhat

### A. Viem Configuration (`monad.ts`)
```typescript
import { defineChain, createPublicClient, http } from 'viem';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.monad.xyz'],
      webSocket: ['wss://testnet-rpc.monad.xyz'],
    },
    public: {
      http: [
        'https://testnet-rpc.monad.xyz',
        'https://rpc.ankr.com/monad_testnet',
        'https://rpc-testnet.monadinfra.com',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'MonadScan',
      url: 'https://testnet.monadscan.com',
    },
    monadVision: {
      name: 'MonadVision',
      url: 'https://testnet.monadvision.com',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 0,
    },
  },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http('https://testnet-rpc.monad.xyz'),
});
```

---

### B. Foundry Configuration (`foundry.toml`)
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.28"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
monad_testnet = "https://testnet-rpc.monad.xyz"

[etherscan]
monad_testnet = { key = "${MONADSCAN_API_KEY}", url = "https://api-testnet.monadscan.com/api" }
```

**Deploying via Foundry Forge:**
```bash
forge create src/YourContract.sol:YourContract \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $PRIVATE_KEY \
  --broadcast
```

---

### C. Hardhat Configuration (`hardhat.config.ts`)
```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      monadTestnet: process.env.MONADSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "monadTestnet",
        chainId: 10143,
        urls: {
          apiURL: "https://api-testnet.monadscan.com/api",
          browserURL: "https://testnet.monadscan.com",
        },
      },
    ],
  },
};

export default config;
```

---

## 7. Smart Contract Verification

Contracts can be verified on both MonadVision (Sourcify) and MonadScan:

### 1. Verification via Sourcify (MonadVision)
```bash
forge verify-contract <CONTRACT_ADDRESS> <CONTRACT_NAME> \
  --chain 10143 \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
```

### 2. Verification via MonadScan (Etherscan-compatible)
```bash
forge verify-contract <CONTRACT_ADDRESS> <CONTRACT_NAME> \
  --chain 10143 \
  --verifier etherscan \
  --verifier-url https://api-testnet.monadscan.com/api \
  --etherscan-api-key $MONADSCAN_API_KEY
```

---

## 8. Data Indexing & Infrastructure

High-throughput applications (like streaming, DEXes, and analytics) require dedicated indexing:

* **Envio (HyperIndex & HyperSync)**:
  * Ultra-fast indexing engine tailored for Monad's 300ms block cadence.
  * Query historical event logs in real time via GraphQL.
  * Integration guide: [https://docs.envio.dev](https://docs.envio.dev)
* **Goldsky**:
  * Subgraphs and real-time data replication pipelines for Monad testnet.
  * Docs: [https://docs.goldsky.com](https://docs.goldsky.com)
* **Subsquid (SQD)**:
  * Decentralized data lake and indexer framework.

---

## 9. Smart Contract Implementation Pattern: Salary Streaming

Below is the production-ready architecture pattern implemented in FlowPay (`MonadStreamFlow.sol`):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MonadStreamFlow
 * @dev High-frequency, real-time per-second salary streaming protocol with auto-savings on Monad.
 */
contract MonadStreamFlow {
    struct Stream {
        address employer;
        address employee;
        uint256 deposit;           // Total deposited funds (in wei)
        uint256 ratePerSecond;     // Wei streamed per second
        uint256 startTime;         // Timestamp when stream started
        uint256 stopTime;          // Timestamp when funds run out
        uint256 regularWithdrawn;  // Total regular salary withdrawn
        uint256 savingsWithdrawn;  // Total savings withdrawn
        uint16 savingsBps;         // Auto-save percentage in bps (1000 = 10%)
        bool isActive;             // Stream active status
        string title;              // Role/Description
    }

    uint256 public nextStreamId;
    mapping(uint256 => Stream) public streams;

    event StreamCreated(uint256 indexed streamId, address indexed employer, address indexed employee, uint256 deposit);
    event SalaryWithdrawn(uint256 indexed streamId, address indexed employee, uint256 amount, bool fromSavings);
    event SavingsRateUpdated(uint256 indexed streamId, uint16 newSavingsBps);

    function createStream(address employee, uint256 ratePerSecond, string calldata title) external payable returns (uint256 streamId) {
        require(msg.value > 0, "Deposit must be > 0");
        require(ratePerSecond > 0, "Rate must be > 0");
        require(employee != address(0) && employee != msg.sender, "Invalid employee");

        uint256 duration = msg.value / ratePerSecond;
        require(duration > 0, "Deposit too small");

        streamId = nextStreamId++;
        uint256 start = block.timestamp;

        streams[streamId] = Stream({
            employer: msg.sender,
            employee: employee,
            deposit: msg.value,
            ratePerSecond: ratePerSecond,
            startTime: start,
            stopTime: start + duration,
            regularWithdrawn: 0,
            savingsWithdrawn: 0,
            savingsBps: 1000,
            isActive: true,
            title: title
        });

        emit StreamCreated(streamId, msg.sender, employee, msg.value);
    }

    function getStreamDetails(uint256 streamId) external view returns (
        uint256 totalEarned,
        uint256 availableRegular,
        uint256 reservedSavings,
        uint256 remainingDeposit,
        bool isStreaming
    ) {
        Stream memory s = streams[streamId];
        if (s.deposit == 0) return (0, 0, 0, 0, false);

        uint256 current = block.timestamp;
        uint256 effectiveTime = current >= s.stopTime ? s.stopTime : current;

        if (effectiveTime > s.startTime) {
            uint256 elapsed = effectiveTime - s.startTime;
            totalEarned = elapsed * s.ratePerSecond;
            if (totalEarned > s.deposit) totalEarned = s.deposit;
        }

        uint256 totalReserved = (totalEarned * s.savingsBps) / 10000;
        reservedSavings = totalReserved > s.savingsWithdrawn ? totalReserved - s.savingsWithdrawn : 0;

        uint256 totalRegular = totalEarned - totalReserved;
        availableRegular = totalRegular > s.regularWithdrawn ? totalRegular - s.regularWithdrawn : 0;

        uint256 totalWithdrawn = s.regularWithdrawn + s.savingsWithdrawn;
        remainingDeposit = s.deposit > totalWithdrawn ? s.deposit - totalWithdrawn : 0;
        isStreaming = s.isActive && current < s.stopTime;
    }
}
```

---

## 10. AI / ChatGPT System Prompt Template

When collaborating with ChatGPT, Claude, or Codex on Monad development tasks, copy-paste the prompt block below:

```markdown
You are an expert blockchain software engineer specializing in the Monad Layer-1 blockchain ecosystem.

Key Context & Guidelines:
1. Network: Monad Testnet (Chain ID 10143), Currency: MON (18 decimals).
2. RPC Endpoint: https://testnet-rpc.monad.xyz | Explorer: https://testnet.monadscan.com.
3. Architecture: Monad features 300ms block times, 10,000 TPS, optimistic parallel execution, MonadDb asynchronous I/O, and MonadBFT pipelined consensus.
4. EVM Compatibility: 100% bytecode compatible (Fusaka fork). Max contract size is 128 KB. Linear memory expansion up to 8 MB. Storage warm reads are grouped into 128-slot pages.
5. Tooling: Prefer Viem (^2.x) for TypeScript web3 apps and Foundry/Hardhat for smart contract engineering.
6. When writing code, prioritize security, reentrancy guards, sub-cent fee optimization, and high-frequency UX patterns.
```

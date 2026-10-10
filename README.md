# FlowPay (MonadStreamFlow) — Real-Time Salary Streaming on Monad

> **Live Hackathon Submission for Monad Hackathon**  
> **Official Monad Documentation:** [https://docs.monad.xyz](https://docs.monad.xyz)  
> **Monad Hackathon Notion Portal:** [Monad Foundation Hackathon Portal](https://monad-foundation.notion.site/3486367594f28050a188f3178fc61735?v=3486367594f281c291a6000cabf5ebd0)

---

## ⚡ Overview

**FlowPay** is a high-frequency, per-second payroll streaming and automated micro-savings protocol purpose-built for the **Monad blockchain**. 

Traditional payroll models force employees to wait 15 or 30 days to access their earned money, driving millions into predatory payday loans or credit card debt. FlowPay transforms compensation from a batched monthly liability into a continuous, real-time financial stream:

- **Per-Second Streaming**: Salaries accrue dynamically every single second as work happens.
- **On-Demand Micro-Withdrawals**: Employees can withdraw any portion of their accrued earnings at any time.
- **Pay-As-You-Earn Auto-Savings**: Workers can configure an automated savings split (e.g., 5%–30%) that routes into a reserved vault with every tick of the clock.
- **Employer Escrow & Risk Controls**: Employers deposit payroll into an escrow contract, track real-time liability, top up balances, or pause/cancel streams with automatic pro-rata refunds.

---

## 🏆 Hackathon Track Alignment

FlowPay aligns directly with the core focus tracks outlined in the [Monad Foundation Hackathon Guidelines](https://monad-foundation.notion.site/3486367594f28050a188f3178fc61735?v=3486367594f281c291a6000cabf5ebd0):

1. **Consumer Products & Payments**:
   - Creating "invisible," frictionless financial products on-chain.
   - Second-by-second micro-payments and instant liquidity for workers without waiting for traditional banking cycles.
2. **On-chain Finance & Trading**:
   - Continuous liquidity management and programmatic escrow accounting.
   - High-throughput streaming contracts that maintain solvency checks and dynamic accounting on every interaction.

---

## 🚀 Why Monad? (How FlowPay Leverages Monad)

Salary streaming has historically suffered from severe friction on legacy Layer-1 blockchains (and even standard Layer-2 rollups). Micro-payments and streaming protocols require an infrastructure with **sub-second latency**, **ultra-low gas fees**, and **massive parallel throughput**. 

Here is how FlowPay leverages Monad's architectural innovations:

### 1. 300ms Block Times & Sub-Second Settlement
* **The Problem on Other Chains**: On Ethereum (12s blocks) or slow L2s (1–3s soft finality), waiting for a withdrawal confirmation breaks the fluid "instant digital banking" user experience.
* **The Monad Solution**: Monad's **300ms block time** enables near-instant on-chain execution. When an employee taps *"Withdraw $15 for lunch"*, the transaction confirms almost instantaneously (tested at ~295ms–312ms), offering a Web2-grade mobile payment feel backed by cryptographic finality.

### 2. 10,000 TPS & Parallel Execution
* **The Problem on Other Chains**: Real-world corporate payroll involves thousands of employees across organizations. On EVM chains with single-threaded sequential execution, peak payroll windows or mass withdrawals congest the network and cause gas spikes.
* **The Monad Solution**: Monad's **optimistic parallel execution engine** dynamically detects state dependencies and executes independent transactions across multiple cores. Because Employee A's withdrawal and Employee B's auto-save rate change touch separate stream IDs, Monad processes them concurrently with zero head-of-line blocking.

### 3. Sub-Cent Micro-Transaction Economics
* **The Problem on Other Chains**: With gas costs ranging from $0.20 to $15.00 on conventional networks, withdrawing a $5 micro-salary or adjusting a 5% savings slider is economically unviable.
* **The Monad Solution**: Monad's throughput architecture reduces gas fees to fractions of a cent (<$0.001 per transaction). Workers are free to make frequent micro-withdrawals throughout the day without fees eating away their hard-earned pay.

### 4. MonadDb & Asynchronous Execution
* **The Problem on Other Chains**: Disk I/O bottlenecks and sequential state updates severely limit the capacity of smart contracts performing continuous mathematical recalculations.
* **The Monad Solution**: FlowPay takes advantage of **MonadDb** (custom asynchronous state backend) and deferred execution to enable ultra-fast state lookups (`getStreamDetails`) and state updates without stalling block validation.

---

## 📜 Smart Contract Architecture (`MonadStreamFlow.sol`)

The protocol core is implemented in Solidity (`^0.8.28`) and optimized for Monad EVM compatibility.

### Contract Highlights:
```solidity
struct Stream {
    address employer;
    address employee;
    uint256 deposit;           // Total deposited funds (in wei)
    uint256 ratePerSecond;     // Wei streamed per second
    uint256 startTime;         // Timestamp when stream started
    uint256 stopTime;          // Timestamp when funds run out
    uint256 regularWithdrawn;  // Total regular salary withdrawn
    uint256 savingsWithdrawn;  // Total savings withdrawn
    uint16 savingsBps;         // Auto-save percentage in basis points (1000 = 10%)
    bool isActive;             // Stream active status
    string title;              // Role description (e.g. "Lead Protocol Engineer")
}
```

### Core Functions:
| Function | Access | Description |
| :--- | :--- | :--- |
| `createStream(employee, ratePerSecond, title)` | Employer | Initializes a salary stream with deposited `MON` escrow. Calculates dynamic `stopTime` based on deposit. |
| `getStreamDetails(streamId)` | Public / View | Calculates real-time accrued total, reserved auto-savings, spendable balance, and remaining escrow in real time using `block.timestamp`. |
| `withdrawSalary(streamId, amount)` | Employee | Transfers available spendable salary directly to the employee's wallet in native `MON`. |
| `withdrawSavings(streamId, amount)` | Employee | Unlocks and transfers accrued funds from the protected auto-savings reserve. |
| `setSavingsPercentage(streamId, newSavingsBps)`| Employee | Updates the auto-save split (up to 5,000 bps / 50%) dynamically. |
| `topUpStream(streamId)` | Employer | Extends the stream runtime by depositing additional `MON` into escrow. |
| `cancelStream(streamId)` | Employer | Stops the stream; locks accrued funds for the employee and refunds remaining unearned deposit to the employer. |

---

## 🌐 Monad Testnet Configuration

FlowPay is configured for deployment on the official **Monad Testnet**:

| Parameter | Value |
| :--- | :--- |
| **Network Name** | Monad Testnet |
| **Chain ID** | `10143` |
| **Currency Symbol** | `MON` (18 Decimals) |
| **RPC Endpoint** | `https://testnet-rpc.monad.xyz` |
| **WebSocket RPC** | `wss://testnet-rpc.monad.xyz` |
| **Alternative RPCs** | `https://rpc-testnet.monadinfra.com`<br>`https://rpc.ankr.com/monad_testnet` |
| **Block Explorer 1** | [MonadScan (testnet.monadscan.com)](https://testnet.monadscan.com) |
| **Block Explorer 2** | [MonadVision (testnet.monadvision.com)](https://testnet.monadvision.com) |
| **Multicall3 Address** | `0xcA11bde05977b3631167028862bE2a173976CA11` |

---

## 🏗️ Repository Architecture

This repository contains two complementary packages:

```
Monad Hackathon/
├── chatgpt/                   <-- FlowPay Interactive Product Demo (Current Workspace)
│   ├── docs/superpowers/      <-- E2E Design specs & implementation plans
│   ├── index.html             <-- HTML entry point
│   ├── src/
│   │   ├── main.jsx           <-- Presentation demo interface
│   │   └── styles.css         <-- Modern fintech design system
│   └── package.json
│
└── anti/                      <-- On-Chain Web3 Implementation
    ├── contracts/
    │   ├── MonadStreamFlow.sol <-- High-throughput streaming Solidity contract
    │   ├── compile.js         <-- solc compiler script
    │   └── deploy.js          <-- Monad testnet viem deployer
    ├── src/
    │   ├── config/monad.ts    <-- Monad chain definitions & RPC setup
    │   ├── hooks/             <-- Web3 live streaming & balance hooks
    │   └── App.tsx            <-- Dual-role Web3 dApp with Monad wallet integration
    └── package.json
```

1. **`chatgpt/` (FlowPay Interactive Demo)**:
   - A zero-friction, ultra-responsive simulation designed for hackathon evaluators and demo presentations.
   - Requires no wallet installation, gas funding, or faucet steps, allowing immediate testing of the employer/employee lifecycle.
2. **`anti/` (MonadStreamFlow Web3 dApp)**:
   - The production on-chain dApp with `viem`, Monad Testnet chain definition, sub-second block confirmations, and `MonadStreamFlow.sol` smart contract integration.

---

## 🛠️ Quickstart: Running the Application

### Prerequisites
- Node.js >= 18
- npm or yarn

### 1. Run the FlowPay Demo (`chatgpt`)
```bash
# From the chatgpt directory:
npm install
npm run start
```
Open [http://localhost:5173](http://localhost:5173) in your browser to experience live salary accrual, auto-savings configuration, and instant payouts.

### 2. Deploy Smart Contract to Monad Testnet (`anti`)
```bash
# From the anti directory:
npm install
# Compile contract
node contracts/compile.js
# Deploy with private key (funded with testnet MON)
PRIVATE_KEY=0xYourPrivateKey node contracts/deploy.js
```

---

## 🔗 Official Monad Links & References

- **Monad Documentation**: [https://docs.monad.xyz](https://docs.monad.xyz)
  - [Architecture & Parallel Execution](https://docs.monad.xyz)
  - [Deploying Smart Contracts](https://docs.monad.xyz)
  - [Connecting to Monad Testnet](https://docs.monad.xyz)
- **Monad Hackathon Notion Portal**: [Monad Foundation Hackathon Portal](https://monad-foundation.notion.site/3486367594f28050a188f3178fc61735?v=3486367594f281c291a6000cabf5ebd0)
- **Official Monad Website**: [https://monad.xyz](https://monad.xyz)
- **Monad Twitter/X**: [@monad_xyz](https://x.com/monad_xyz)

---

*Built with passion for the Monad Hackathon.*

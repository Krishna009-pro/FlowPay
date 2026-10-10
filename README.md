# FlowPay ⚡ — Salary That Keeps Moving

> **A real-time, per-second payroll and automated savings protocol built natively on Monad.**  
> *Submitted to the Monad Hackathon (Consumer Products & Payments / On-Chain Finance Tracks).*

[![Monad Testnet](https://img.shields.io/badge/Network-Monad%20Testnet%20(10143)-8A2BE2?style=flat-square)](https://docs.monad.xyz)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?style=flat-square)](https://soliditylang.org/)
[![Vite](https://img.shields.io/badge/Frontend-Vite%20%2B%20React%20%2B%20Viem-646CFF?style=flat-square)](https://vitejs.dev/)
[![Block Explorer](https://img.shields.io/badge/Explorer-MonadScan-00C087?style=flat-square)](https://testnet.monadscan.com)

---

## 💡 The Problem: Why Does Payday Still Work Like It’s 1975?

Think about how work actually happens: you show up Monday morning, write code, serve customers, manage operations, and generate value every hour of the day. 

Yet, under the traditional banking system:
* **Your money is held hostage for 15 to 30 days** while banks and payroll processors batch ACH transfers behind the scenes.
* **Cash-flow emergencies don't wait for the 1st or the 15th.** When an unexpected car repair or medical bill hits on day 10, workers are forced into predatory payday loans (often charging 300%+ APR) or credit card interest.
* **Saving money requires painful willpower.** People try to save whatever is left over at the end of the month—which is usually zero.

**FlowPay changes the baseline assumption:** If you produce value by the second, you should be able to access that value by the second.

---

## ⛓️ The Baseline: Why Blockchain? Why Monad?

Building a continuous payroll product on top of traditional fintech APIs (like Stripe or Plaid) is fundamentally broken:
1. **ACH batch transfers take 2–5 business days.** You cannot stream money over banking rails that shut down on weekends.
2. **Custodial risk.** Intermediaries hold your payroll in central accounts. If a fintech company goes bankrupt, your wages are frozen.

### Why Legacy Blockchains Failed at This
Attempts to build salary streaming on Ethereum or standard Layer-2s ran into immediate brick walls:
* **Gas Fees Destroy Micro-Payments:** If gas costs $2.00 to $15.00 per transaction, withdrawing $20 to buy lunch or adjust your savings rate by 5% is economically ridiculous.
* **Latency Kills the Experience:** Waiting 12 seconds (or minutes for finality) feels clunky and stressful for everyday workers used to instant Apple Pay or Venmo taps.

### Why Monad Is the Foundational Breakthrough
Monad isn't just an incremental speedup; it is the **exact technological baseline** that makes real-time payroll viable:

| Monad Innovation | What It Means for Everyday Payroll |
| :--- | :--- |
| **300ms Block Time** | When you click *"Withdraw 15 MON for groceries"*, your wallet receives the funds virtually instantaneously (~300ms). It feels like a Web2 banking app, backed by cryptographic finality. |
| **10,000 TPS Parallel Execution** | In real life, thousands of workers get off their shift at the exact same hour. Monad's parallel execution handles simultaneous withdrawals across thousands of employees without network congestion or gas fee spikes. |
| **Sub-Cent Fees (<$0.001)** | Workers can claim small sums multiple times a day or automate micro-savings without losing their hard-earned pay to network fees. |
| **Transparent Escrow Contracts** | Employers lock funds into self-enforcing smart contracts. Workers can independently verify that their employer's payroll escrow is funded and solvent before putting in a single hour of work. |

---

## ⚙️ How FlowPay Works

FlowPay operates on a transparent, self-balancing on-chain model:

```
[ Employer ]
     │
     ▼  Deposits native MON into Escrow
┌────────────────────────────────────────────────────────┐
│               FlowPay Smart Contract                   │
│                                                        │
│   • Streams MON per second (Rate: Wei / Second)        │
│   • Checkpoints elapsed time & vesting state           │
│   • Auto-partitions into liquid pay vs. savings vault  │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
        (100% - Savings%)             (Savings %)
               │                          │
               ▼                          ▼
      [ Liquid Claimable ]       [ Reserved Auto-Save ]
      Available to withdraw      Locked in on-chain vault
      any second into wallet     for future financial safety
```

### 1. Second-by-Second Vesting
The contract computes earned pay directly from elapsed block timestamps multiplied by a fixed wei-per-second rate. No off-chain crons or centralized keepers are required.

### 2. Pay-As-You-Earn Auto-Savings
Employees can choose a savings rate between **0% and 30%** (in 5% increments). Whenever pay vests:
* The selected percentage is partitioned directly into a dedicated on-chain reserve vault.
* The remaining portion is immediately liquid and claimable.
* You save money before you even have the chance to spend it.

### 3. Checkpointed Math & Zero Retroactive Debt
* **Pausing:** If an employer pauses a stream, vesting freezes at that exact timestamp. When resumed, it picks up smoothly without phantom accrual.
* **Underfunding Protection:** Vesting automatically caps when cumulative accrued pay reaches the employer's total deposited balance.
* **Top-Ups:** When an employer adds more funds, the contract checkpoints the balance. The employee is **not** paid retroactively for unfunded downtime, protecting employer solvency while keeping accounting 100% transparent.

---

## 🌐 Monad Testnet Configuration

FlowPay is built and configured for the official **Monad Testnet**:

| Parameter | Value |
| :--- | :--- |
| **Network Name** | Monad Testnet |
| **Chain ID** | `10143` (`0x279f`) |
| **Native Token** | `MON` (18 decimals) |
| **RPC URL** | `https://testnet-rpc.monad.xyz` |
| **WebSocket RPC** | `wss://testnet-rpc.monad.xyz` |
| **Backup RPCs** | `https://rpc.ankr.com/monad_testnet`<br>`https://rpc-testnet.monadinfra.com` |
| **Block Explorer** | [https://testnet.monadscan.com](https://testnet.monadscan.com) |
| **Alternative Explorer** | [https://testnet.monadvision.com](https://testnet.monadvision.com) |
| **Multicall3 Address** | `0xcA11bde05977b3631167028862bE2a173976CA11` |

---

## 🚀 Quickstart

### Prerequisites
* **Node.js** (v18+) & **npm**
* Web3 browser wallet (**MetaMask** / **Rabby**) on [Monad Testnet](https://docs.monad.xyz) (Testnet MON available at [faucet.monad.xyz](https://faucet.monad.xyz))

### Run Locally
```bash
# 1. Clone & enter repository
git clone https://github.com/Krishna009-pro/FlowPay.git
cd FlowPay

# 2. Install dependencies
npm install

# 3. Launch application
npm start
```

Open **`http://localhost:5173`** in your browser.

---

## 🖥️ How to Test & Demo FlowPay

When you open the app, you will experience the complete payroll lifecycle:

### As an Employee:
1. **Watch the live accrual clock**: See your earned pay tick upward in real time.
2. **Adjust your Auto-Save rate**: Move the slider between 0% and 30%. Watch your liquid available balance and your protected savings vault update automatically.
3. **Withdraw liquid earnings**: Click **"Withdraw funds"**, enter an amount (or click **MAX**), and submit a claim. Your available balance updates instantly upon transaction receipt.
4. **Inspect your savings**: Check the "Save as you earn" donut chart and review your total accumulated reserve.

### As an Employer:
1. **Monitor payroll health**: Check your total deposited escrow, the employee's vesting progress, and remaining runway.
2. **Stream controls**: Pause the salary stream during leave or contract pauses, and resume it with a single click.
3. **Top up the escrow**: Add additional `MON` to extend the employee's payroll runway seamlessly.

---

## 📁 Repository Structure

```
FlowPay/
├── docs/superpowers/          # Formal specifications and technical plans
│   ├── specs/                 # Architecture & on-chain design documents
│   └── plans/                 # Step-by-step implementation roadmaps
│
├── src/                       # Frontend application
│   ├── main.jsx               # React application entry & payroll views
│   └── styles.css             # Tailored, work-focused fintech design system
│
├── contracts/                 # Smart contracts & deployment scripts
│   ├── src/FlowPay.sol        # High-throughput salary streaming contract
│   └── script/                # Foundry testnet deployment scripts
│
├── MONAD_DEV_REFERENCE.md     # Complete Monad architecture, RPC, & dev guide
├── README.md                  # Project overview & running instructions
├── index.html                 # HTML application shell
├── package.json               # Project manifest & dependencies
└── .gitignore                 # Excludes node_modules, keys, and build files
```

---

## 🔒 Security & Mathematical Integrity

FlowPay is engineered with strict decentralized finance best practices:
* **Checks-Effects-Interactions**: All internal balances and timestamps are checkpointed before native `MON` transfers occur.
* **Reentrancy Protection**: Guarded against reentrancy attacks on all claim functions.
* **No Speculative DeFi / Yield Risks**: FlowPay does not lend your payroll to third-party lending protocols or risk user funds in unaudited yield farms. Your money is either in verified contract escrow or in your personal wallet.
* **Non-Custodial**: Neither FlowPay nor any employer can seize already-vested employee funds.

---

## 🔗 Official Monad Resources & Links

* **Official Developer Docs**: [https://docs.monad.xyz](https://docs.monad.xyz)
* **Monad Hackathon Notion**: [Monad Foundation Hackathon Portal](https://monad-foundation.notion.site/3486367594f28050a188f3178fc61735?v=3486367594f281c291a6000cabf5ebd0)
* **Monad Official Faucet**: [https://faucet.monad.xyz](https://faucet.monad.xyz)
* **Circle Testnet USDC Faucet**: [https://faucet.circle.com](https://faucet.circle.com)
* **Testnet Explorer (MonadScan)**: [https://testnet.monadscan.com](https://testnet.monadscan.com)
* **Testnet Explorer (MonadVision)**: [https://testnet.monadvision.com](https://testnet.monadvision.com)
* **Official Monad Website**: [https://monad.xyz](https://monad.xyz)

---

## 💬 Community & License

Built with ❤️ for builders, workers, and the **Monad Hackathon**.  
Released under the [MIT License](LICENSE).

# FlowPay ⚡ — High-Frequency Payroll on Monad

> **Real-time, per-second salary streaming protocol with automated micro-savings.**  
> Built for the **Monad Hackathon** (Consumer Payments & On-Chain Finance).

[![Monad Testnet](https://img.shields.io/badge/Chain_ID-10143-8A2BE2?style=flat-square)](https://docs.monad.xyz)
[![Block Time](https://img.shields.io/badge/Block_Time-300ms-blue?style=flat-square)](https://docs.monad.xyz)
[![Throughput](https://img.shields.io/badge/Target_TPS-10%2C000-green?style=flat-square)](https://docs.monad.xyz)
[![Gas Cost](https://img.shields.io/badge/Tx_Fee-%3C$0.001-orange?style=flat-square)](https://docs.monad.xyz)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?style=flat-square)](https://soliditylang.org/)

---

## 📊 Benchmark: Traditional Payroll vs. Ethereum vs. Monad

| Metric | Traditional Payroll (ACH) | Ethereum L1 | **FlowPay on Monad** |
| :--- | :--- | :--- | :--- |
| **Payment Frequency** | 15 – 30 days (batched) | Block-based (~12s) | **Per second (Real-Time)** |
| **Settlement Time** | 2 – 5 business days | 12s – 15m (finality) | **300ms** (600ms finality) |
| **Average Tx Fee** | $0.25 – $1.50 per batch | $2.00 – $15.00+ | **<$0.001** |
| **Max Throughput** | Batch limited | 15 – 30 TPS | **10,000 TPS** |
| **$10 Micro-Withdrawal** | ❌ Impossible | ❌ Negative ROI (Gas > Value) | **✅ Economical & Instant** |
| **Custody & Solvency** | Centralized intermediary | Smart contract | **Non-Custodial Escrow** |

---

## ⚡ Core Protocol Parameters

* **Accrual Basis**: Computed continuously on-chain via `ratePerSecond` ($\text{Wei} / \text{Second}$).
* **Standard 30-Day Rate**: $3,200 \text{ MON/month} = \frac{3,200 \times 10^{18}}{2,592,000 \text{ s}} \approx 1.2345679 \times 10^{15} \text{ Wei/s}$.
* **Auto-Savings Range**: **0% – 30%** in **5%** steps (`0` to `3,000 bps`).
* **Vesting Invariant**: $\text{Gross Accrued} \le \text{Cumulative Deposits}$ (stops at underfunding).
* **Solvency Protection**: Non-retroactive checkpoints on stream `pause`, `resume`, and `topUp`.
* **Contract Limits**: Compiles under Solidity `0.8.28` (200 optimizer runs), well within Monad's **128 KB** code limit.

---

## 🌐 Network Specifications

| Parameter | Proven Value |
| :--- | :--- |
| **Network Name** | Monad Testnet |
| **Chain ID** | `10143` (`0x279f`) |
| **Native Token** | `MON` (18 Decimals) |
| **Block Cadence** | `300ms` |
| **RPC Endpoint** | `https://testnet-rpc.monad.xyz` |
| **WebSocket** | `wss://testnet-rpc.monad.xyz` |
| **Block Explorer** | [https://testnet.monadscan.com](https://testnet.monadscan.com) |
| **Alternative Explorer** | [https://testnet.monadvision.com](https://testnet.monadvision.com) |
| **Multicall3** | `0xcA11bde05977b3631167028862bE2a173976CA11` |

---

## 🚀 Quickstart

### Prerequisites
* **Node.js** >= 18
* Web3 wallet (**MetaMask** / **Rabby**) on Monad Testnet (`10143`)
* Testnet MON from [faucet.monad.xyz](https://faucet.monad.xyz)

### Run
```bash
# 1. Clone & enter repository
git clone https://github.com/Krishna009-pro/FlowPay.git
cd FlowPay

# 2. Install dependencies
npm install

# 3. Start local server
npm start
```

App loads at: **`http://localhost:5173`**

---

## 🛠️ User Flows

* **Employee**:
  * Real-time accrual clock updates every 1 second.
  * Adjust auto-save partition (0%–30%).
  * Withdraw liquid pay or separate savings reserve via native `MON` transfers.
* **Employer**:
  * Fund stream escrow in native `MON`.
  * Track runway and accrued liabilities in real time.
  * One-click stream controls: `pause`, `resume`, `topUp`.

---

## 🔗 Official Links

* **Monad Developer Docs**: [https://docs.monad.xyz](https://docs.monad.xyz)
* **Hackathon Notion**: [Monad Foundation Portal](https://monad-foundation.notion.site/3486367594f28050a188f3178fc61735?v=3486367594f281c291a6000cabf5ebd0)
* **Testnet Faucet**: [https://faucet.monad.xyz](https://faucet.monad.xyz)
* **MonadScan**: [https://testnet.monadscan.com](https://testnet.monadscan.com)

# FlowPay On-Chain MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FlowPay's simulated payroll dashboard with one usable native-MON salary stream on Monad Testnet, including employer funding controls, employee claims, auto-save accounting, and real transaction history.

**Architecture:** A small Solidity contract owns one stream and uses the deploying wallet as immutable employer. A React/Vite client reads the contract through viem and sends role-authorized writes through the user's injected wallet; the browser never holds a private key. The existing FlowPay layout stays recognizable while all payroll balances and activity come from the configured testnet contract.

**Tech Stack:** Solidity 0.8.28, Foundry, React 18, Vite 6, viem, injected EIP-1193 wallet, Monad Testnet (chain ID 10143).

**Spec:** `docs/superpowers/specs/2026-10-10-flowpay-onchain-design.md`

## Global Constraints

- Monad Testnet chain ID is `10143`; native token is `MON` with 18 decimals.
- Compile Solidity `0.8.28` with optimizer enabled and `200` runs.
- Use native MON only; no yield, ERC-20, mainnet, multi-stream, backend, account login, or agent-controlled transactions.
- Never show simulated balances, activity, or transaction success as on-chain state.
- Do not put private keys or seed phrases in source, frontend configuration, or browser storage.
- Keep the FlowPay payroll identity; use a small Monad Testnet status indicator without Monad/Blitz branding or copied layouts.

## Review Focus

- **Stream runs out of funding between reads:** the contract view and counter must stop at deposited value; top-up must not pay for the unfunded interval. Check in Task 1's checkpoint/preview implementation and Task 4's capped display calculation.
- **Savings rounding over repeated checkpoints:** fractional reserve remainder must survive claims and rate changes. Check the accumulator in Task 1 and display only the contract-reported claimable amount in Task 4.
- **Wrong wallet, wrong chain, or missing deployment address:** no write control may appear usable and the page must explain the required setup. Check the state gates in Task 3 and Task 4.
- **Rejected, reverted, or pending wallet transaction:** report pending until a receipt, show errors on failure, and refresh chain state only after confirmation. Check the write helper in Task 3 and each action flow in Task 4.
- **Empty or unavailable contract history:** show an honest empty/error state and never fill it with example transactions. Check the event reader in Task 3 and its rendering in Task 4.

---

### Task 1: Build the one-stream native-MON contract

**Files:**
- Create: `contracts/src/FlowPay.sol`
- Create: `foundry.toml`
- Add: `forge-std` under `contracts/lib/forge-std` for the deployment script

**Interfaces:**
- Employer authority is the immutable `employer` set to `msg.sender` in the constructor.
- Public writes: `createStream(address employee_, uint256 ratePerSecond_) payable`, `topUp() payable`, `pause()`, and `resume()` are employer-only; `setSavingsRate(uint16 rateBps)`, `claimSalary(uint256 amount)`, and `claimSavings(uint256 amount)` are employee-only.
- Public view: `getSnapshot()` returns a named `Snapshot` with `employee`, `ratePerSecond`, `totalDeposited`, `totalVested`, `salaryAccrued`, `savingsAccrued`, `salaryClaimed`, `savingsClaimed`, `salaryClaimable`, `savingsClaimable`, `contractBalance`, `availableToVest`, `savingsRateBps`, `checkpointTime`, `streamCreated`, `paused`, and `underfunded`.
- Emit `StreamCreated`, `ToppedUp`, `StreamPaused`, `StreamResumed`, `SavingsRateChanged`, `SalaryClaimed`, and `SavingsClaimed` events with the changed amount/rate and relevant wallet addresses.

- [ ] **Step 1: Set Foundry defaults** in `foundry.toml`: source `contracts/src`, script `contracts/script`, output `contracts/out`, library `contracts/lib`, Solidity `0.8.28`, optimizer enabled, optimizer runs `200`.
- [ ] **Step 2: Install the deployment-script library** with `forge install foundry-rs/forge-std --no-commit`; keep it as a project dependency under `contracts/lib/forge-std`.
- [ ] **Step 3: Implement contract state and role-checked stream creation** in `contracts/src/FlowPay.sol`. Reject zero employee, zero rate, zero initial deposit, and a second stream.
- [ ] **Step 4: Implement checkpointed vesting and the snapshot**. Advance only by active elapsed seconds, cap cumulative vesting at cumulative deposits, preserve the savings division remainder, and expose `underfunded` when no unvested deposit remains.
- [ ] **Step 5: Implement top-up, pause/resume, savings-rate change, and claims**. Checkpoint before every state transition; allow savings rates from 0–3000 basis points in 500-point increments; cap claims to their corresponding accrued balance; use checks-effects-interactions and a reentrancy guard.
- [ ] **Step 6: Compile the contract** with `forge build`. Expected: successful compile using the pinned Solidity version and no unresolved imports.

### Task 2: Add deployment and testnet setup instructions

The existing README contains speculative claims about production behavior, throughput, yield, cancellation, and testing. Replace those with accurate documentation of only the implemented one-stream testnet MVP.

**Files:**
- Create: `contracts/script/DeployFlowPay.s.sol`
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Deployment creates `FlowPay` with the broadcasting wallet as employer and prints the deployed address and employer.
- Frontend configuration uses `VITE_MONAD_RPC_URL`, `VITE_FLOWPAY_CONTRACT_ADDRESS`, and `VITE_FLOWPAY_DEPLOYMENT_BLOCK`; no secret is stored in these values.
- The documented PowerShell deployment command is `forge script contracts/script/DeployFlowPay.s.sol:DeployFlowPay --rpc-url $env:MONAD_TESTNET_RPC_URL --account flowpay-employer --broadcast`.

- [ ] **Step 1: Add the deployment script** at `contracts/script/DeployFlowPay.s.sol`, using Foundry's encrypted account/broadcast flow and confirming the configured chain ID is `10143`.
- [ ] **Step 2: Add public configuration placeholders** to `.env.example`; ensure `.env`, `.env.local`, Foundry keystore files, and broadcast artifacts are ignored where appropriate.
- [ ] **Step 3: Document wallet setup and deployment** in `README.md`: install Foundry, import an encrypted employer account, obtain test MON from the official faucet, deploy to Monad Testnet, copy the printed address/block into local frontend config, connect the employer wallet, and create the stream. Include the official RPC and MonadScan Testnet links from `MONAD_DEV_REFERENCE.md`.
- [ ] **Step 4: Check deployment configuration** with `forge build` and inspect the documented command and env names against the script/config files.

### Task 3: Add the viem wallet and contract client

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/chain/config.js`
- Create: `src/chain/flowPayAbi.js`
- Create: `src/chain/flowPay.js`

**Interfaces:**
- `config.js` exports `MONAD_TESTNET`, `FLOWPAY_ADDRESS`, `DEPLOYMENT_BLOCK`, and `MONADSCAN_TX_URL(hash)`.
- `flowPay.js` exports `connectWallet() -> { address, walletClient, chainId }`, `getWalletChainId()`, `switchToMonadTestnet()`, `readStream() -> { employer, snapshot, blockTimestamp }`, `readActivity() -> event[]`, and `submitAction(walletClient, functionName, args, value?) -> hash`.
- `readActivity()` returns decoded contract events with `name`, `args`, `transactionHash`, `blockNumber`, and `timestamp` where available; callers can link each hash through `MONADSCAN_TX_URL`.

- [ ] **Step 1: Add viem** as a runtime dependency and add `npm run build` to the existing Vite scripts while retaining `npm start`.
- [ ] **Step 2: Define the public chain configuration and ABI** in `src/chain/config.js` and `src/chain/flowPayAbi.js`; block reads/writes with a clear setup error when the address is absent or invalid.
- [ ] **Step 3: Implement wallet setup and read operations** in `src/chain/flowPay.js`, using the official Monad Testnet RPC and EIP-1193 provider; return the current wallet chain ID and support switch/add-chain requests for chain ID `10143`.
- [ ] **Step 4: Implement write and history operations**. Submit wallet-signed calls, return the hash immediately for pending UI, decode only configured-contract events from `DEPLOYMENT_BLOCK`, and surface provider/RPC errors to the caller.
- [ ] **Step 5: Build the frontend bundle** with `npm run build`. Expected: Vite resolves viem and all chain modules.

### Task 4: Replace simulated dashboard actions with real FlowPay actions

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- The UI consumes the chain API from Task 3 and contract snapshot from Task 1; it does not calculate authoritative balances from local state.
- Employer actions call `createStream`, `topUp`, `pause`, and `resume`; employee actions call `setSavingsRate`, `claimSalary`, and `claimSavings`.
- After every write, the UI shows the real transaction hash as pending, waits for a successful receipt, then reloads the snapshot and activity. A rejected or reverted transaction remains an error and does not update balances optimistically.

- [ ] **Step 1: Remove simulated payroll state and copy** from `src/main.jsx`, including hard-coded dollar balances, example activity, fake wallet addresses, and simulated-success toasts.
- [ ] **Step 2: Add wallet and setup states**: disconnected, wrong network, missing contract config, connected employer, connected employee, and read-only viewer; listen for account/chain changes and clean up listeners.
- [ ] **Step 3: Wire employer actions**: create the single stream from employee address, monthly MON rate converted to wei/second using a 30-day month, and initial MON funding; add MON funding; pause and resume only when permitted.
- [ ] **Step 4: Wire employee actions**: refresh the snapshot on a modest interval, tick the display each second from the latest block timestamp, and cap the estimate at available funding; update the 0–30% savings control in 5-point steps; submit separate salary and savings claims in MON.
- [ ] **Step 5: Render confirmed chain activity and transaction states** from decoded contract events; include MonadScan links and explicit empty, loading, pending, and error states.
- [ ] **Step 6: Preserve the existing FlowPay look and responsive layout** in `src/styles.css`, changing labels and actions to native MON and removing the misleading “earning while you wait” yield claim.
- [ ] **Step 7: Build the complete app** with `npm run build`. Expected: Vite succeeds and no demo-only data or simulated transaction path remains in the rendered product.

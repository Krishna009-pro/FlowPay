# FlowPay Multi-Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employer create and manage separate salary streams for multiple employees from one FlowPay dashboard on Monad Testnet, while preserving the current deployed single-stream contract.

**Architecture:** Keep `FlowPay` as a no-argument, one-employee contract with the same public functions and snapshot shape, moving shared accounting into a base contract. Add a payable factory that creates one initialized child contract per employee, indexes it for both employer and employee, and can register the existing legacy contract. The React app reads the factory registry and sends every stream action to the currently selected on-chain contract address.

**Tech Stack:** Solidity `^0.8.28`, solc-js with optimizer enabled at 200 runs, React 18, Vite 6, viem, Monad Testnet (chain ID `10143`).

**Spec:** `docs/superpowers/specs/2026-10-10-flowpay-multi-stream-design.md`

## Global Constraints

- Keep the existing `FlowPay` no-argument deployment path and public ABI.
- Keep the current deployed contract usable as a legacy stream; do not move its funds.
- A factory-created stream is a separate contract and receives its funding directly; the factory must not custody salary funds.
- Keep the app on Monad Testnet, chain ID `10143`; do not deploy to Mainnet.
- Add `VITE_FLOWPAY_FACTORY_ADDRESS` and `VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK`; retain `VITE_FLOWPAY_CONTRACT_ADDRESS` and `VITE_FLOWPAY_DEPLOYMENT_BLOCK`.
- Never put a private key in browser code, `.env.example`, README, or hosting variables.
- Display only contract and registry data read from Monad; do not create simulated employee or stream records.
- Do not implement yield, multiple currencies, automated payroll, backend services, or HR records.
- Do not push this feature to the remote Git repository.

## Review Focus

1. **Factory is unset, malformed, or has no code:** legacy stream reads and actions still work; creating additional streams is clearly unavailable.
2. **Invalid creation inputs or insufficient employer funds:** the factory transaction reverts atomically; no stream appears in either account index.
3. **Import address is an EOA, an uncreated FlowPay, a duplicate, or belongs to another employer:** registration reverts and registry lists remain unchanged.
4. **Wallet disconnects or changes accounts/networks after a stream is selected:** writes remain disabled until the connected account and Monad Testnet are revalidated; no action silently targets a different stream.
5. **A selected child read or activity scan fails:** show the error for that stream and never fall back to another employee’s address or activity.

---

### Task 1: Preserve the single-stream contract and share its accounting

**Files:**
- Create: `contracts/src/FlowPayCore.sol`
- Modify: `contracts/src/FlowPay.sol`
- Create: `contracts/src/FlowPayStream.sol`
- Modify: `contracts/compile.js`

**Interfaces:**
- `FlowPayCore` owns the current snapshot, errors, events, accounting, claims, savings, pause/resume, and top-up functions.
- `FlowPay` remains a no-argument contract. Its constructor sets the employer to `msg.sender`; the employer later calls the inherited `createStream(address employee_, uint256 ratePerSecond_)` with native MON.
- `FlowPayStream` is initialized at deployment with constructor `(address employer_, address employee_, uint256 ratePerSecond_) payable`; its constructor validates the inputs and initializes the same stream state as `createStream`.
- The shared internal initializer is `_createStream(address employee_, uint256 ratePerSecond_, uint256 amount_)`; both deployment paths use it.

- [ ] Move the existing storage, snapshot struct, errors, events, modifiers, accounting functions, and external actions into `FlowPayCore` without changing public names, mutability, parameter types, or snapshot fields.
- [ ] Change `employer` from immutable storage to one-time initialized storage in the base; set it only from the `FlowPay` constructor or the `FlowPayStream` constructor.
- [ ] Refactor `createStream` to call `_createStream`; have the child constructor call `_createStream` with `msg.value` so the employer, employee, rate, initial funding, 10% default savings, checkpoint time, and `StreamCreated` event are initialized atomically.
- [ ] Keep the legacy `FlowPay` constructor argument-free and preserve its public ABI; do not change behavior of its existing one-stream lifecycle.
- [ ] Include `FlowPayCore.sol`, `FlowPay.sol`, `FlowPayStream.sol`, and `FlowPayFactory.sol` in the compiler input sources map so imports resolve in Task 2.
- [ ] Run `node contracts/compile.js`; confirm compilation succeeds and the generated `FlowPay` ABI still exposes `createStream`, `getSnapshot`, `claimSalary`, `claimSavings`, `pause`, `resume`, `topUp`, and `setSavingsRate`.

### Task 2: Add the factory registry and safe legacy import

**Files:**
- Create: `contracts/src/FlowPayFactory.sol`
- Modify: `contracts/compile.js`

**Interfaces:**
- `createStream(address employee, uint256 ratePerSecond) external payable returns (address stream)` creates `FlowPayStream` with the supplied native MON and registers it for `msg.sender` and `employee`.
- `registerExistingStream(address stream) external` registers a created stream only when it has code, reports `msg.sender` as its employer, reports a nonzero employee, and has `streamCreated() == true`.
- `getEmployerStreams(address employer) external view returns (address[] memory)` and `getEmployeeStreams(address employee) external view returns (address[] memory)` return their respective on-chain address lists.
- `isRegistered(address stream) external view returns (bool)` prevents registering or indexing a stream twice.
- `StreamCreatedByFactory(address indexed employer, address indexed employee, address indexed stream)` and `ExistingStreamRegistered(address indexed employer, address indexed employee, address indexed stream)` identify registry changes.

- [ ] Add the factory entry points and mappings for employer and employee lists; reject self-payment and duplicate registrations.
- [ ] Deploy each child with `{value: msg.value}` and append registry entries only after successful child construction; rely on EVM transaction atomicity so a child constructor failure leaves no registration behind.
- [ ] In `registerExistingStream`, check `stream.code.length`, query `employer()`, `employee()`, and `streamCreated()`, require the caller to be the stream employer, and reject uncreated or already-registered streams.
- [ ] Emit the factory events after the matching index updates; the factory itself must not retain the initial stream deposit.
- [ ] Extend the compiler output to save `FlowPayFactory.json` and `FlowPayStream.json` as well as `FlowPay.json`.
- [ ] Run `node contracts/compile.js`; confirm all three artifacts are generated and the factory ABI includes both list reads, creation, registration, and registry events.

### Task 3: Provide a safe Testnet factory deployment path

**Files:**
- Create: `contracts/deployFactory.js`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `contracts/compile.js`

**Interfaces:**
- `node contracts/deployFactory.js` deploys `FlowPayFactory` to Monad Testnet using `PRIVATE_KEY` from the process environment, then reports the transaction hash, contract address, and deployment block.
- The deployed factory is configured with `VITE_FLOWPAY_FACTORY_ADDRESS` and `VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK`; the existing legacy variables remain unchanged.

- [ ] Add a deployment script that refuses any chain other than Monad Testnet `10143`, loads `contracts/out/FlowPayFactory.json`, uses only the environment private key, and prints a MonadScan link and the two public frontend variable names.
- [ ] Do not write over the existing root `.env` values during factory deployment; do not print or persist the private key.
- [ ] Update `.env.example` with blank factory values and preserve the existing legacy contract values.
- [ ] Document compile, deploy, local env configuration, hosting env configuration, and the requirement to rebuild/redeploy the frontend after setting factory values.
- [ ] Run `node contracts/compile.js` and `npm run build`; deployment itself remains a user-signed Testnet action and must not be broadcast during implementation.

### Task 4: Make chain reads and writes stream-address scoped

**Files:**
- Create: `src/chain/flowPayFactoryAbi.js`
- Modify: `src/chain/config.js`
- Modify: `src/chain/flowPayAbi.js`
- Modify: `src/chain/flowPay.js`

**Interfaces:**
- `loadAccountStreams(account) -> { employerStreams: Address[], employeeStreams: Address[] }` reads only the factory’s on-chain indexes and returns empty lists when the factory is not configured.
- `readStream(streamAddress)` reads `employer()` and `getSnapshot()` from exactly `streamAddress`.
- `readActivity(streamAddress, deploymentBlock)` scans events from exactly `streamAddress`; cache state is keyed by stream address and block range.
- `submitAction(walletClient, streamAddress, functionName, args = [], value)` writes to exactly `streamAddress` after the existing wallet and chain checks.
- `createFactoryStream(walletClient, employee, ratePerSecond, funding)` submits the factory’s payable create call and returns its confirmed receipt and created address.
- `registerLegacyStream(walletClient, legacyAddress)` submits the factory registration call for the configured legacy address.

- [ ] Add exact viem ABI entries for the factory functions and events, plus any child constructor-independent reads needed by the UI.
- [ ] Parse and validate factory address and deployment block in `config.js`; distinguish “factory not configured” from malformed configuration and a configured address without bytecode.
- [ ] Replace implicit global-address reads/writes in `flowPay.js` with explicit stream-address parameters; do not add a fallback address inside transaction helpers.
- [ ] Implement account stream loading from factory views and factory configuration checks using the Monad public client.
- [ ] Make activity scanning take an explicit deployment block. For the configured legacy stream use its existing deployment block; for factory children use the factory deployment block so their contract logs are included.
- [ ] Reset or key read/activity caches per stream address so changing the selected stream cannot reuse another stream’s snapshot or events.
- [ ] Run `npm run build`; confirm the app compiles with no implicit single-contract helper calls remaining.

### Task 5: Add employer and employee stream selection to the dashboard

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/style.css`
- Modify: `src/chain/flowPay.js`

**Interfaces:**
- The selected stream record contains `{ address, source, deploymentBlock, employer, employee }`, where `source` is `factory` or `legacy` and all records originate from RPC reads or validated configuration.
- Employer selection includes factory-created streams, employer-registered streams, and the configured legacy stream when the connected wallet is its employer.
- Employee selection includes only factory-indexed streams for the connected employee and the configured legacy stream when that wallet is its employee.
- With no connected wallet, the configured legacy stream remains available as read-only content.

- [ ] Add a stream selector/list that clearly distinguishes “Employer payroll” from “Your salary” and identifies each stream by employee or employer address plus a shortened contract address.
- [ ] Add a **New stream** action that remains available when other streams exist; show an explicit setup message and disable creation if the factory is unset or invalid.
- [ ] Add the create form for employee address, monthly salary, and initial funding. Convert monthly salary to a per-second wei rate using the app’s existing month convention, validate positive values, and submit one payable factory transaction.
- [ ] After receipt confirmation, reload factory lists and select the actual child address returned by the factory event; never create a local placeholder stream.
- [ ] Add employer-only “Import existing stream” for the configured legacy address; submit the registry transaction and reload on confirmation without moving or replacing the old contract.
- [ ] When connected, append the configured legacy stream only if an on-chain read confirms the wallet matches its employer or employee. When disconnected, keep it read-only.
- [ ] Route snapshot, activity, claims, savings changes, pause/resume, top-up, role checks, transaction links, and refresh state through the selected stream record.
- [ ] On wallet account or chain changes, revalidate access and clear a selected stream that is not available to the current wallet; disable writes until the wallet is on Monad Testnet.
- [ ] Keep the existing visual design language; add responsive styles for the selector and creation/import controls without adding fake dashboard content.
- [ ] Run `npm run build`; manually review that with factory values absent, the legacy page remains usable and the create action explains the missing deployment.

### Task 6: Final local verification and handoff for user deployment

**Files:**
- Modify if needed: `README.md`
- No deployment transaction is part of this task.

**Interfaces:**
- Local verification commands: `node contracts/compile.js` and `npm run build`.
- User deployment handoff: deploy `FlowPayFactory` on Monad Testnet, add its address and deployment block to local/hosting environment variables, and rebuild the site.

- [ ] Run `node contracts/compile.js`; expected result: successful compilation and artifacts for `FlowPay`, `FlowPayStream`, and `FlowPayFactory`.
- [ ] Run `npm run build`; expected result: Vite produces a successful production build.
- [ ] Review the full diff for legacy ABI retention, direct child funding, no factory custody, stream-scoped transactions and activity, and absence of fake local stream records.
- [ ] Provide the exact Testnet factory deployment and environment-variable steps to the user; explain the new factory deployment is required because the already deployed contract cannot be upgraded in place.
- [ ] Leave all feature changes local; do not push them to a remote.

## Self-review

- **Spec coverage:** Contract compatibility and shared accounting are covered in Task 1; factory create/index/import behavior in Task 2; deployment/configuration in Task 3; stream-address scoped RPC behavior in Task 4; multi-role selection, legacy compatibility, creation/import, and wallet state in Task 5; final compile/build and user deployment handoff in Task 6.
- **Step scan:** Each checkbox is one implementation or verification action with a named file, function, observable result, or exact command.
- **Type consistency:** Factory creation returns the created child address; account list reads return address arrays; UI stream records carry the address and deployment block used by all chain helpers.
- **Review focus:** All five likely failure cases are exercised by compile/build checks or explicit UI/chain review steps, with no silent contract-address fallback.
- **Proportion:** Tasks are split at the actual contract, configuration/RPC, UI, and deployment boundaries; no unrelated roadmap items are included.

# FlowPay On-Chain MVP Design

> This design supersedes the simulated-only direction in `2026-10-10-flowpay-end-to-end-design.md` and its implementation plan. It follows the user's correction that the product must perform real transactions.

## Goal and scope

Build a genuinely on-chain hackathon MVP for FlowPay: one employer funds a salary stream for one employee in native MON on Monad Testnet; the employee's accrued pay can be claimed on-chain, and both parties can inspect the stream while the employer controls pause/resume.

Use the Monad Foundation developer references supplied by the user for network setup, wallet setup, Foundry, and deployment. `MONAD_DEV_REFERENCE.md` identifies Monad Testnet as chain ID `10143`, native token `MON` with 18 decimals, RPC `https://testnet-rpc.monad.xyz`, and MonadScan Testnet at `https://testnet.monadscan.com`. The Monad Foundation's Agent Hub is a discovery page for independent, unaudited tools, not a FlowPay contract SDK; the app does not integrate third-party agents or give an agent control of payroll funds.

In scope: actual wallet connection, deployment/configuration of FlowPay's own contract, employer stream creation and funding, real-time on-chain vesting display, employer top-up and pause/resume, employee claim, on-chain auto-save reserve and separate savings claim, on-chain event history, and explorer links.

Out of scope: mainnet, yield/DeFi integrations, ERC-20 salary tokens, multiple employers/employees/streams, account/password login, a server, and agent-controlled transactions. Never fall back to fake balances or simulated confirmations when wallet/contract setup is unavailable.

## Users and roles

- **Employer wallet:** deploys or controls the configured FlowPay contract, creates one stream to an employee address with an initial native-MON deposit and monthly rate, adds funds, and pauses/resumes accrual.
- **Employee wallet:** reads the same stream, sets an auto-save percentage, claims liquid earned pay, and separately claims reserved savings.
- A connected address is authorized by on-chain contract roles. Switching the app's display is not a substitute for connecting the correct wallet. A third-party address may view public stream details but cannot submit role-restricted actions.

## Contract behavior

Implement one non-upgradeable Solidity contract for one stream, with immutable employer authority and one employee address. The deployment script supplies the employer address, which must match the employer wallet used to create the stream. The employer calls `createStream(employee, ratePerSecond)` payable once with a nonzero deposit. The contract then supports employer-only `topUp`, `pause`, and `resume`; employee-only `setSavingsRate`, `claimSalary`, and `claimSavings`; and read-only stream snapshot getters. There is no arbitrary employer withdrawal or cancellation/refund path in this MVP.

Vesting is calculated from active elapsed seconds at the configured wei-per-second rate, capped by cumulative deposits. Pausing checkpoints accrued time and freezes vesting; resuming starts accrual at the new checkpoint. When cumulative vested amount reaches cumulative deposits, the stream reports underfunded and stops accruing. A top-up checkpoints before increasing deposits, so elapsed time without funds is not paid retroactively and accrual can continue from the top-up.

Savings rate is 0–30% in 5-point increments. Changing the rate checkpoints existing accrual at the old rate, then applies the new rate only to future accrual. The contract accounts saved amounts as an on-chain reserve; savings are not yield and are not automatically transferred to another protocol. Employee claims reduce the corresponding liquid or reserved balance and transfer native MON to the employee wallet. Preserve fractional basis-point rounding between checkpoints so repeated claims or rate updates cannot erase the employee's savings dust.

Required events: stream created, top-up, pause, resume, savings-rate change, salary claim, savings claim. State transitions and claims must enforce role checks, nonzero addresses/rates/deposits, amount bounds, checks-effects-interactions, and reentrancy protection. The contract must not permit aggregate salary and savings claims to exceed vested, funded value.

## App behavior

Keep the app a React/Vite single-page product with a distinct FlowPay payroll visual identity. Show a small, clear Monad Testnet network indicator for transparency, without using Monad or Blitz branding or copying their layouts.

Use an injected EIP-1193 wallet (MetaMask-compatible) and viem. Provide connect, local disconnect, current address and role, testnet chain validation/switch request, contract setup status, stream snapshot, and clear guidance when prerequisites are missing. A deployment script outputs the contract address; the app reads it from `VITE_FLOWPAY_CONTRACT_ADDRESS`. No private key or seed phrase belongs in source code, frontend environment variables, or browser storage.

Read actual contract state and events from the Monad testnet RPC. The live counter can update from confirmed contract parameters and current chain time between reads; clearly identify a pending wallet transaction and only show success after a confirmed receipt. For each transaction, show the real hash and a MonadScan Testnet link. History comes from contract events, not local-only mock rows. RPC polling/subscriptions must be modest and resilient to rate limits or temporary errors.

Employer screen: create/fund the single stream, see employee, rate, total deposit, escrow balance, funding available for future accrual, active/paused/underfunded state, add funds, pause, resume, and recent contract events.

Employee screen: see earned, liquid claimable, savings reserved/claimable, previously claimed, and current savings rate; set the rate; claim liquid salary; claim reserved savings; and see recent contract events.

Amounts are native MON, not dollars. Do not show the previous hard-coded dollar demo data, mock transactions, simulated explorer links, or estimated yield as if real.

## Deployment and configuration

Use the Monad Foundation's Foundry guidance with Solidity `0.8.28`, optimizer enabled, 200 runs, Monad Testnet RPC, and chain ID `10143` from the supplied developer reference. Include an explicit deployment command/script and a `.env.example` containing only public settings (RPC URL, chain ID, contract address placeholder). Keep local environment files and account secrets out of version control. Use an encrypted Foundry keystore/account for deployment instead of putting a raw private key in the app or committed configuration. Document that the user must obtain testnet MON from the official faucet and submit the deployment/interaction transactions from their own wallet.

The deployer should be the employer address, or the script must explicitly set the employer address and verify it matches the intended wallet. After deployment, configure the resulting address and verify that the app can read the contract before enabling write controls.

## Technical references and limits

- Monad testnet, faucet, RPC, and explorer: `https://docs.monad.xyz/developer-essentials/testnet` and `MONAD_DEV_REFERENCE.md`.
- Wallet setup, Foundry, and deploy instructions: the user's Monad Foundation "Blitz Essentials" resource page.
- Agent Hub: `https://app.monad.xyz/agents`; directory entries are independent third parties and are not audited or endorsed. FlowPay does not invoke them for payroll.
- The salary example in `MONAD_DEV_REFERENCE.md` is a reference only. Its saved percentage is computed retroactively, and the sample omits pause/resume and top-up behavior; FlowPay uses checkpointed rate changes and explicit funding/pausing rules above.

## Acceptance criteria

- With a wallet on Monad Testnet and a deployed/configured FlowPay contract, employer actions submit real transactions, wait for receipts, and update from contract reads.
- Employee sees on-chain time-based vesting; pause freezes vesting, resume restarts it, and an underfunded stream does not accrue beyond deposits.
- Top-up allows a funded active stream to accrue again without paying for the unfunded interval.
- Savings-rate changes affect only future vesting after the old rate is checkpointed; salary and savings claims are independent and cannot overdraw.
- Each action is authorized to the employer or employee address in the contract; a wrong network or missing address blocks writes with actionable setup instructions.
- Event history and transaction links point to real MonadScan Testnet transactions.
- The app never reports simulated success or fake balances as actual chain state, and it remains usable on desktop and mobile screens.

# FlowPay Monad Demo: Idle Yield Implementation Plan

> **Status:** Draft for product-owner review. Approval of the design does not approve a yield protocol, a funds-moving implementation, or a Testnet transaction.

**Goal:** Extend the existing Monad Testnet MON salary-stream demo with employee-opt-in yield on vested, unclaimed pay while keeping unvested employer funds liquid and preserving truthful claim availability.

**Design:** `docs/superpowers/specs/2026-10-14-flowpay-monad-idle-yield-design.md`

**Current system:** React 18, Vite 6, viem, Solidity 0.8.28. `FlowPayFactory` deploys one `FlowPayStream` per employer/employee pair. Each stream receives native MON and pays both salary and savings claims from its own native balance.

## Non-negotiable boundaries

- This plan is for the Monad Testnet demo only (chain ID `10143`); it does not apply to the India INR payroll product.
- No Mainnet deployment, real funds, or production payroll use.
- Do not broadcast transactions as part of local implementation. Any later Testnet deployment or strategy interaction must be initiated by the user from their own wallet.
- Do not integrate a protocol merely because it appears in a registry. The Monad Testnet registry lists Peridot lending contracts, but the exact asset market, current liquidity, deployed-code identity, admin controls, withdrawal behavior, and audit scope still need verification.
- No protocol is selected yet. Peridot's Testnet pWMON market is a diligence candidate only. Morpho's documented supported network is Monad mainnet chain ID 143, not Monad Testnet 10143.
- Do not display simulated yield as real yield. If the strategy gate fails, stop the funds-moving scope and ship no yield feature.
- Never let an employee invest unvested employer reserve. Never count the same vested amount as both liquid-claimable and invested.
- The first release uses explicit employee allocation transactions. An automatic allocation rule is deferred.
- Do not add or run tests during execution unless the user explicitly asks for testing/verification; preserve the test cases below as implementation acceptance criteria for that later authorization.

## Review focus

1. **Principal accounting:** vested, unclaimed pay must leave the liquid-claimable bucket exactly when it enters the invested bucket; redemption must reverse that movement exactly once.
2. **Liquidity:** a claim can only succeed for MON that is actually liquid in the stream. Strategy value is not claim liquidity.
3. **Employer reserve:** all unvested MON and enough accounting for future vesting remain outside the adapter. Strategy loss cannot silently consume unvested reserves.
4. **Asset identity:** native MON and wrapped MON are different assets. The approved strategy adapter, token addresses, and unwrap behavior must match the reviewed market.
5. **Protocol trust:** deployed bytecode, proxy/implementation, admin powers, pause behavior, audit scope, utilization, exit limits, and dependency risks must be recorded for the exact Testnet deployment.
6. **Failure handling:** revert, partial redemption, low pool liquidity, stale reads, strategy pause, stream pause, employee opt-out, and wallet/network changes must never cause the UI to overstate a liquid balance.

## Implementation sequence

### Task 1: Complete candidate strategy due diligence and select or stop

**Files:**
- Create: `docs/superpowers/reviews/2026-10-14-flowpay-monad-yield-diligence.md`
- Update only if the conclusion changes a design assumption: `docs/superpowers/specs/2026-10-14-flowpay-monad-idle-yield-design.md`

**Starting candidate:** Peridot Testnet pWMON / WMON deployment listed in the Monad-maintained Testnet protocol registry. Registry addresses are discovery inputs only and must be re-read from the primary registry and verified on chain immediately before any implementation.

1. Record chain ID, RPC/explorer evidence, registry commit/date, all relevant token/market/proxy/implementation addresses, code hashes, source verification, and the precise native-to-wrapped MON flow.
2. Confirm the market accepts the exact wrapped MON token expected by FlowPay; inspect mint/redeem selectors, approvals, exchange-rate math, available cash, utilization, withdrawal cap, and failure behavior from source and RPC reads.
3. Identify proxy upgrade/admin roles, pause controls, oracle/bridge dependencies, permissions, ownership, deployment age, incident history, and whether any cross-chain path is called by a local deposit or redemption.
4. Obtain the full external audit report(s); map the audited commit and contract scope to the exact deployed implementation. Record unresolved findings and whether the specific WMON market and integration path are included.
5. Verify that repeated partial withdrawals and a full exit work on Monad Testnet with test tokens using a separate user-controlled wallet; do not use FlowPay stream balances in this diligence step.
6. Record the variable-rate source, fee treatment, incentives, and risks; avoid using an off-chain API as transaction authorization.
7. Recommend **pass**, **conditional pass**, or **fail** with evidence and a dated reviewer. On fail or missing critical evidence, stop Tasks 3–6 and retain the stream demo without yield.

**Acceptance:** A reviewer can reproduce the chain and source checks and determine whether the exact candidate can receive and return the target asset. A listed address or published audit alone is not treated as approval.

**Gate:** Product-owner selection and independent security review of the exact strategy, custody path, and accounting/liquidity design are required before any code path can move stream funds into the strategy.

### Task 2: Freeze employee liability, liquidity, and exit semantics

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-flowpay-monad-idle-yield-design.md`
- Create: `docs/superpowers/reviews/2026-10-14-flowpay-monad-yield-accounting.md`

1. Define an integer-only accounting state machine for each stream: vested-unclaimed amount, liquid-claimable amount, invested principal, strategy shares/value, realized gain/loss, requested redemption, and redeemed-liquid amount.
2. Define deposit eligibility as `vested salary - salary claimed - already invested`; reject zero, over-available, paused/invalid, or unvested allocations.
3. On a successful strategy allocation, move the exact source amount out of immediately claimable salary and record the received shares. Do not increment `salaryClaimed` for an investment; investment is a separate state transition.
4. On redemption, remove the redeemed shares and return actual received MON to the stream's liquid balance. Apply realized strategy gain/loss explicitly; do not infer it from expected rates.
5. V1 claim behavior: allow salary claims only up to liquid-claimable MON. If more is invested, the employee first requests/executes a redemption, waits if required, then claims. Never auto-redeem during a salary claim.
6. Savings bucket semantics must remain explicit. Decide whether yield is only from salary accrual or also from currently accrued savings before implementation; default recommendation is salary only until product owner approves otherwise.
7. Specify how a redemption loss changes the employee's Testnet position and the visible vested amount; because this is a demo, do not imply the employer has discharged any real-world wage obligation by an on-chain loss.
8. Specify per-stream and global pause behavior, strategy incident circuit breaker, employee opt-out, and what happens if stream vesting pauses or exhausts.

**Acceptance:** A written transition table covers every balance movement and proves no amount is simultaneously claimable, invested, or claimed. The table reconciles to the strategy's actual receipt-token model and exposes partial/full exit limits.

**Gate:** Product owner reviews the liability and loss semantics; independent security reviewer approves the accounting invariants before funds-moving implementation.

### Task 3: Specify adapter and vault ownership from the verified protocol

**Files:**
- Create: `docs/superpowers/reviews/2026-10-14-flowpay-monad-yield-integration-boundary.md`
- No Solidity changes until Tasks 1 and 2 pass their gates.

1. Compare two boundaries: (A) each stream contract owns adapter shares, or (B) a separate per-stream employee yield vault owns shares and only the stream can call it.
2. Compare employee ownership, isolated accounting, deployment gas, share custody, native/wrapped token handling, upgrades, emergency exit, and compatibility with already-deployed streams.
3. Prefer the separate vault only if a user-controlled employee position and exact per-stream attribution are enforceable without creating a privileged FlowPay escape hatch; otherwise specify the stream-owned model.
4. Define a narrow fixed-strategy interface for deposit, preview/current redeemable value, liquid withdrawal capacity, partial redeem, full redeem, and pause status. Do not allow user-supplied strategy/token addresses.
5. Define the approved strategy address as immutable per deployed vault/stream instance or fixed in reviewed code. Do not add a mutable admin strategy setter to existing stream contracts.
6. Record how the flow handles wrapped MON. Any unwrap step must be explicit and occur only after the strategy has returned underlying WMON to the reviewed wrapper.

**Acceptance:** The integration boundary exposes only the reviewed operations and cannot redirect stream funds to an arbitrary contract or token.

**Gate:** Independent security review signs off on the protocol-specific call surface and immutable address configuration before Tasks 4–6.

### Task 4: Implement local accounting and contract changes after gates

**Files, subject to approved boundary:**
- Modify: `contracts/src/FlowPayCore.sol`
- Modify or create: `contracts/src/FlowPayStream.sol` and a separate vault/adapter contract if Task 3 selects it
- Modify: `contracts/compile.js`
- Modify/create: contract tests only if the user authorizes testing

1. Add explicit opt-in, allocation, redemption, and pause-state entry points while preserving legacy `FlowPay` ABI and existing stream claim behavior whenever yield is disabled.
2. Require employee authorization for allocation and employee recovery/exit actions. Employer-only stream controls must not grant access to invested employee assets.
3. Add non-reentrancy and checks-effects-interactions around every external protocol call. Confirm adapter return amounts and post-call balances rather than trusting a return value alone.
4. Prevent allocation above liquid vested/unclaimed salary. Protect enough native MON for unvested reserve accounting; never use future vesting balance as a deposit source.
5. Maintain distinct principal/share/gain/loss/exit events with stream and employee indexed. Ensure a failed adapter call reverts the whole allocation without changing FlowPay accounting.
6. Add strategy circuit breaker behavior that blocks new deposits while preserving the reviewed exit path; the breaker must not transfer or confiscate assets.
7. Preserve factory discovery and legacy stream support. Existing stream contracts have no adapter and must continue with yield disabled.
8. Compile contract artifacts and review ABI/storage/deployment changes. Do not broadcast deployment or strategy transactions.

**Acceptance criteria for the later authorized implementation:** No double counting on allocate/redeem/claim; only vested unclaimed salary can be invested; disabled-yield and legacy streams behave as before; pool illiquidity cannot be presented as immediate liquidity; external call failures leave balances unchanged; no arbitrary destination or strategy can be set.

### Task 5: Add employee yield UI and on-chain activity

**Files:**
- Modify: `src/chain/flowPay.js`
- Create/update: `src/chain/flowPayYieldAbi.js` or equivalent reviewed ABI module
- Modify: `src/main.jsx`
- Modify: `src/styles.css`
- Tests only if separately authorized.

1. Read all yield data from the selected stream/vault address and key caches by that exact address; do not fall back to another employee stream or a global strategy address.
2. Add the separate balance labels from the design: vested-unclaimed, liquid claimable now, invested principal, current strategy value, realized gain/loss, pending redemption, and last updated block/time.
3. Show the exact strategy and underlying token, variable-rate source and timestamp if available, fees, current available exit amount, audit/review status, and a concise risk/withdrawal disclosure before any signature.
4. Add an employee-only explicit allocation amount flow with wallet preview, validation against liquid vested salary, confirmation/revert/pending states, and a clear allowance/signature sequence for ERC-20 WMON if required.
5. Add redemption request/execute steps matching the real protocol. Keep salary claiming separate and show `claim now` capped to actual liquid amount.
6. Add “Stop future allocations”; keep existing shares visible and keep exit controls available under the real protocol's rules.
7. Decode yield and salary events into a stream-specific activity list; distinguish strategy estimate changes from realized gains/losses and completed claims.
8. Handle wrong network, wallet account change, missing strategy configuration, stale RPC/indexer/rate information, protocol pause, and transaction rejection without presenting stale values as live.

**Acceptance:** An employee can see the exact currently liquid amount and understand every required action to turn an invested position back into claimable MON. No yield/APY value is fabricated or rendered as guaranteed.

### Task 6: Local review and user-controlled Testnet handoff

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if the chosen integration needs public, non-secret configuration
- No `.env.local`, wallet secrets, or deploy artifacts are to be edited.

1. Document the Testnet-only scope, selected protocol/contract addresses, strategy risks, deployment order, user-controlled wallet steps, and how yield-disabled legacy streams behave.
2. Keep private keys exclusively in the user's local process environment; never use Vite variables or browser storage for signing secrets.
3. Run only compile/build or other verification commands explicitly authorized by the user at implementation time. Do not deploy or send any transaction from this plan.
4. Review the diff for incorrect custody, unvested reserve exposure, claim overstatement, arbitrary adapter targets, and stale yield display.
5. Provide a deployment checklist for the user to execute from their own wallet only after independent review and explicit release approval.

**Acceptance:** The local code is reviewable and the README clearly distinguishes real on-chain Testnet strategy integration from any non-yield/disabled state; no deployment, fund movement, or production claim is made.

## Release gates and stop conditions

- **Gate A — candidate:** exact Testnet strategy and asset verified; diligence report passes.
- **Gate B — accounting:** employee ownership, invest/claim/redemption/loss semantics approved; independent security review passes.
- **Gate C — integration:** adapter/vault call surface and address immutability approved; independent security review passes.
- **Gate D — implementation:** product owner separately approves the implementation plan and authorizes local code work.
- **Gate E — Testnet release:** product owner explicitly authorizes deployment and wallet-signed Testnet interactions after local review.

Stop before funds-moving code if a candidate lacks verified contract identity, a relevant audit scope, understandable exit behavior, or a defensible loss/liquidity model. In that case, continue improving the MON stream demo without calling savings or a projected display “yield.”

## References

- Monad Testnet protocol registry: https://github.com/monad-crypto/protocols and https://raw.githubusercontent.com/monad-crypto/protocols/refs/heads/main/protocols-testnet.csv
- Morpho documented supported networks: https://docs.morpho.org/developers/api/get-started/
- Peridot's published audit listing: https://peridot.finance/audits
- Peridot's risk disclosures, including smart-contract and liquidity risks: https://peridot.finance/docs/risks
- Existing roadmap gate: `docs/superpowers/plans/2026-10-11-flowpay-payroll-system.md`

## Self-review

- The plan starts with protocol due diligence and can stop without code or funds movement.
- Product and accounting decisions left open in the design are made explicit as review deliverables, not implementation assumptions.
- Candidate protocol metadata and audit claims are treated as inputs that must be matched to the exact deployed Testnet code.
- Contract, adapter, UI, event, configuration, and user deployment boundaries have separate tasks.
- Legacy and yield-disabled streams remain supported; no Mainnet or India payroll scope is included.

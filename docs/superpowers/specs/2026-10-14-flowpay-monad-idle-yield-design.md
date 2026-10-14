# FlowPay Monad Demo: Idle Yield Design

**Status:** Draft for product-owner review
**Scope:** Optional MON yield in the Monad Testnet salary-stream demo only. This is not the India INR payroll product and does not authorize a Testnet deployment or any funds-moving transaction.

## Context

The Monad demo currently streams native MON into per-employee `FlowPayStream` contracts. Each stream accrues salary and a separate savings allocation over time. Both claim functions transfer native MON directly from the stream contract. The factory indexes streams so an employer and employee can discover their streams.

The current `savingsAccrued` / `savingsClaimed` values are accounting categories, not a yield position. They do not interact with a vault, lending market, staking contract, or yield token. The stream's visible claimable balance assumes its MON remains liquid in the contract.

The proposed feature explores this demo story: an employee can choose to put some already-vested, unclaimed MON to work, see principal and yield separately, and withdraw available MON while the stream keeps vesting.

## Goals

- Demonstrate a real, opt-in MON yield position on Monad Testnet, if a suitable strategy passes review.
- Keep unvested MON employer-owned and outside any yield strategy.
- Keep salary principal distinct from yield, fees, liquidity, and exit status.
- Preserve a usable liquid balance for ordinary partial claims.
- Make strategy loss, changing yield, and withdrawal constraints visible.
- Allow yield allocation to be disabled without changing normal stream vesting and claims.

## Out of scope

- INR balances, Indian payroll claims, bank payout rails, or employer reserve yield.
- Any claim that a Testnet strategy is safe for production or that yield is guaranteed.
- Automatically investing employee pay without explicit employee opt-in.
- A general yield aggregator or automatic strategy switching.
- Contract deployment, protocol deposits, or withdrawals as part of this design work.

## Product recommendation

Use an employee-opt-in allocation of **vested and unclaimed salary only**. Keep the employer's unvested reserve and any unvested future pay in the stream contract. Begin with one fixed, reviewed strategy adapter selected after due diligence; do not build a strategy marketplace or promise a return.

For the first implementation, the employee should explicitly allocate an amount from their vested/unclaimed salary, rather than silently auto-sweeping every newly vested second. The UI can later offer an opt-in allocation rule after the user has seen how liquidity and loss are handled. Explicit allocation makes the initial Testnet demo legible and avoids surprising users with an involuntary exit delay.

An employee claim should use the stream's liquid reserve first. If available liquid MON is insufficient, the app must present a separate withdrawal/redemption action and show its current availability. Do not make a claim appear successful or instantly payable merely because the strategy position has value on paper.

## User experience

1. The employee opens a stream and sees **Vested and unclaimed**, **Liquid and claimable now**, **Invested principal**, **Estimated strategy value**, **Realized yield**, and **Pending redemption** as separate amounts.
2. The employee opens “Earn on idle MON”, reviews the strategy name, underlying token, current variable rate (if supported by a reliable source), fees, liquidity and exit constraints, and confirms an allocation amount.
3. The app shows a wallet transaction preview. The employee signs the transaction; the app never holds a signing key.
4. The strategy position appears separately from salary accrual. Estimated value can update as chain state changes, but the UI labels it as variable and not guaranteed.
5. The employee can request an amount back to the stream's liquid reserve. The UI shows whether it is immediately available or pending. Once liquid, the amount can be claimed through the ordinary salary flow.
6. Turning off future allocations stops new deposits. It does not erase the position; the employee withdraws or waits for pending exits under the strategy's actual rules.

## Accounting and contract boundaries

### Existing invariant to preserve

The current stream calculation treats `salaryAccrued - salaryClaimed` and `savingsAccrued - savingsClaimed` as payable from the stream's native balance. Investing assets without changing this model can leave claimable liabilities larger than the stream's liquid balance. The yield implementation must not rely on `address(this).balance` alone to describe employee backing.

### Proposed separation

- **Unvested reserve:** employer-funded MON reserved for future vesting; never allocated to yield.
- **Liquid vested salary:** employee-owned vested amount available to claim immediately.
- **Invested principal:** employee-opted-in vested salary represented by strategy shares/receipts and recorded separately from claimed salary.
- **Strategy value:** current redeemable estimate of those receipts; it may change and must not be represented as guaranteed salary or guaranteed yield.
- **Realized yield:** amount actually redeemed above tracked principal, net of fees and losses. Do not label unrealized appreciation as earned cash.
- **Pending exit:** amount requested but not yet returned as liquid MON.

The exact liability model must be specified before implementation. At minimum, it must prevent the same vested amount from being both immediately claimable and invested, protect the unvested reserve from strategy calls, and reconcile deposits, share balances, redemptions, claims, fees, and losses. Partial claims must never require the whole position to exit.

### Adapter boundary

Keep strategy-specific calls behind a narrow adapter interface that can report the input asset, shares received, estimated redeemable value, liquid withdrawal capacity, and any pending-exit state. The stream or a dedicated employee vault must be the only authorized caller for its position. No arbitrary strategy address or asset should be selectable by a user at runtime.

The design must still decide whether the adapter belongs in each stream contract or in a separate employee vault. Prefer the separate vault if it can preserve per-employee ownership and make stream claims/vesting less upgrade-sensitive; verify the gas and accounting implications before selecting it.

## Strategy selection gate

No strategy is selected by this document. The Monad-maintained protocol registry lists lending deployments on Testnet, including Peridot, but a registry entry proves only that contract metadata is listed; it does not establish current market liquidity, operational status, audit scope, upgrade controls, withdrawal behavior, or suitability for FlowPay. The current public Morpho API documentation lists Monad mainnet (chain ID 143), not Monad Testnet (chain ID 10143), so it is not evidence of a supported Testnet MON vault.

Before selecting any candidate, record and review:

- exact chain ID, contract addresses, underlying asset, and bytecode/source identity;
- whether the candidate currently accepts native MON or a specific wrapped MON token;
- current available liquidity and partial-withdrawal behavior;
- all withdrawal queues, cooldowns, caps, and failure behavior;
- audit reports and their exact deployed-code scope;
- upgrade/admin authorities, pause powers, oracle dependencies, and incident history;
- rate source, reward-token dependence, fees, and what can cause principal loss;
- a testnet-only proof of deposit, partial exit, full exit, and strategy failure handling before any FlowPay integration.

If no candidate passes the gate, keep the feature at a clearly labeled preview/prototype stage; do not fabricate yield or call a local simulation a real strategy.

## Failure and safety behavior

- Strategy deposit or redemption reverts: preserve the user's position and show the transaction failure; never mark the amount as liquid.
- Withdrawal liquidity is insufficient: report the available amount and pending state, and retain the remainder as invested.
- Strategy value is below contributed principal: show the loss against principal; do not backfill it from employer unvested reserves.
- Strategy is paused or compromised: disable new deposits through an explicit circuit breaker; preserve any supported exit path and surface an incident state.
- RPC, indexer, or strategy-rate source is unavailable: mark the estimate stale/unavailable. Chain contract state remains authoritative for transaction eligibility.
- Employee opts out: stop future allocations, retain the existing position, and allow exit only under the strategy's real rules.
- Stream is paused or exhausted: vested balances remain attributable to the employee; future vesting stops as currently specified. Existing yield positions are not silently moved or forfeited.

## Demo success criteria

- A user can distinguish salary accrued, liquid claimable salary, invested principal, variable strategy value, realized yield, and pending exits.
- Only vested/unclaimed employee salary can be allocated; employer unvested reserve remains liquid in the stream.
- A partial allocation and partial redemption do not double-count or erase salary claims.
- A liquid partial claim remains usable while another portion is invested.
- The UI communicates variable yield, strategy risk, and exit constraints before a user confirms.
- Activity history can reconcile allocation, redemption, realized yield/loss, and salary claims to on-chain events.
- The stream works normally when yield is disabled or unavailable.

## Open decisions for review

1. Approve the scope as a Monad Testnet demo only, separate from INR payroll.
2. Approve opt-in allocation of vested/unclaimed salary only, with explicit allocations for the first release.
3. Decide the target liquid-claim reserve and whether claims beyond it should remain blocked pending employee redemption or can use a separately funded liquidity buffer.
4. Select a strategy only after the diligence checklist is complete; Peridot Testnet may be investigated as a candidate, but is not approved by this design.
5. Decide whether the employee yield position lives in the stream contract or a separate vault after an accounting/gas comparison.

## Implementation gate

The existing FlowPay roadmap requires a separate reviewed design and implementation plan for employee-yield work and independent security review before a funds-moving plan. After product-owner review of this design, write the detailed plan. Do not integrate a strategy or move funds until the strategy and the liability/liquidity model have also passed the stated review gates.

## Research references (checked 14 October 2026)

- Monad-maintained protocol registry, including Testnet protocol addresses: https://github.com/monad-crypto/protocols and https://raw.githubusercontent.com/monad-crypto/protocols/refs/heads/main/protocols-testnet.csv
- Morpho supported networks: https://docs.morpho.org/developers/api/get-started/ (Monad listed as chain ID 143).
- Existing FlowPay baseline: `contracts/src/FlowPayCore.sol`, `contracts/src/FlowPayStream.sol`, and `contracts/src/FlowPayFactory.sol`.
- Product and release gates: `docs/superpowers/plans/2026-10-11-flowpay-payroll-system.md` and `docs/superpowers/specs/2026-10-11-flowpay-launch-decisions.md`.

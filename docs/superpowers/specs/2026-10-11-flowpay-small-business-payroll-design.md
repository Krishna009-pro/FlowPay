# FlowPay Small-Business Payroll System Design

## Status and intent

This document supersedes the hackathon-only product framing in the 2026-10-10 MVP designs. Those documents remain useful as records of the current Testnet prototype and its contract behavior. This spec defines the intended product direction; it does not claim that the system described here has been implemented or is production-ready.

## Product goal

FlowPay helps small businesses run payroll for a team using per-second salary streaming. Employees can watch earned pay accrue and claim it before a conventional pay date. The long-term product includes two distinct yield pools: employee-owned vested pay that has not been claimed, and employer-owned payroll funds that have not vested. The first yield release targets only employee-earned, unclaimed pay. Employer reserve yield is deferred until payroll liquidity can be reliably protected.

## Target customer and users

The initial customer is a small business paying a team. Core roles are:

- **Business owner/admin:** creates the business workspace, controls funding and policy, and manages access.
- **Payroll operator:** prepares employee and payroll changes for review.
- **Approver:** reviews and authorizes payroll actions according to business policy.
- **Employee:** views their compensation stream, claims vested pay, and may opt in to yield on eligible unclaimed pay.

An initial release may collapse roles for small teams, but the data model and audit trail should not assume one wallet is the entire organization. A wallet address is a transaction authority, not a complete employee or business identity.

## Core experience

### Employer payroll

- Create a business workspace and invite payroll users and employees.
- Maintain employee records with wallet, compensation, currency, employment status, and effective dates.
- Create and manage one salary stream per employee, including start, pause, resume, compensation change, and end actions with explicit effective-time rules.
- Review payroll funding needs and runway before funding or changing streams.
- Present a payroll review showing recipients, rates, funding amounts, and resulting transactions before approval.
- Require configured approvals for sensitive actions; record who proposed, approved, and executed each change.
- Show each employee's vested amount, unvested reserve, claimed pay, stream health, and transaction history.
- Notify authorized users when a stream is near exhaustion, underfunded, paused, or has a pending action.
- Export payroll activity and employee payment records for bookkeeping.

### Employee pay

- Show live per-second earned pay, available-to-claim salary, previously claimed salary, and employer/stream details.
- Allow partial claims while the stream continues; show transaction state and confirmed receipt.
- Offer an explicit, revocable opt-in for eligible vested-but-unclaimed pay to enter a yield strategy.
- Display principal and yield separately. Yield must be based on actual strategy accounting, variable, and never presented as guaranteed salary.
- Explain current withdrawal availability, any strategy exit delay, fees, and material risks before opting in or withdrawing.

## Yield design and ownership

Maintain logically separate accounting and permissions for each pool:

1. **Employee earned-pay pool — first yield phase.** Only vested salary that is owed to the employee and not claimed may be allocated. Employee authorization is required. Salary principal remains an employee liability and must not be reclassified as employer reserve. A withdrawal or claim must account for strategy liquidity and clearly show any delay. If immediate withdrawal cannot be guaranteed, the UI must say so before allocation.
2. **Employer unvested-reserve pool — later phase.** These funds remain employer payroll capital until vesting. The employer may opt in only under a policy that preserves every upcoming vesting obligation, pause/top-up behavior, and a defined liquidity buffer. Yield losses or exit delays must not silently reduce wages already vested or prevent scheduled vesting. Do not ship this phase until those invariants are enforceable and independently reviewed.

For both pools, show strategy identity, deposited principal, accrued/realized yield, fees, withdrawals, current exit status, and transaction history. No UI may imply a fixed APY or guaranteed yield. Any integration is an explicit external protocol dependency and requires a separate risk, custody, and recovery design. The current contract's savings reserve is not a yield integration and earns no yield.

## System boundaries and architecture direction

The existing application is a React/Vite client connected directly to one Solidity contract on Monad Testnet. It supports one employer, one employee, native MON, and wallet-based transaction signing. It has no business identity, team registry, payroll approvals, durable application backend, notification service, accounting export, or yield adapter.

The complete product will need to separate:

- **Organization and payroll application layer:** business membership, employee profiles, compensation history, role policy, approval workflow, notifications, and exportable records.
- **On-chain settlement layer:** audited contracts for stream lifecycle, funding, vesting, claims, and events. The browser must never hold a server or employer private key.
- **Yield strategy boundary:** opt-in allocation and withdrawal accounting for employee-earned balances first, behind a narrowly scoped adapter and explicit liquidity/risk disclosures. Employer-reserve integration is a later independent phase.
- **Indexing and operations:** reliable event processing, reconciliation against chain state, transaction monitoring, support tooling, backups, and incident response.

The existing deployed single-stream contract is immutable and remains a prototype/legacy deployment. It must not be treated as an upgradeable production system. The existing multi-stream factory proposal is not sufficient as the final architecture: it covers stream discovery only and does not provide business identity, payroll approvals, end-of-employment semantics, durable operations, or yield.

## Product phases

### Phase 0: Prototype reconciliation

- Verify which contract address and deployment block are canonical; repository docs, deployment artifact, and local environment currently disagree.
- Correct public setup/deployment documentation and clearly label the current app as Testnet prototype.
- Establish contract and UI regression checks for existing stream accounting before architectural replacement.

### Phase 1: Team payroll foundation

- Define organization, employee, membership, and role model.
- Support multiple employees and streams with explicit lifecycle and compensation-change semantics.
- Add payroll preview, funding runway, approvals/audit history, and employee self-service views.
- Keep employer reserve liquid; do not add yield in this phase.

### Phase 2: Employee earned-pay yield

- Select and integrate a yield strategy only after due diligence and a threat/liquidity review.
- Add opt-in allocation for vested unclaimed pay, separate principal/yield accounting, exit/claim handling, and risk disclosures.
- Test that salary liabilities and claims remain correct across allocation, partial withdrawal, paused streams, and strategy failure or delay.

### Phase 3: Employer reserve yield

- Explore opt-in yield for unvested payroll reserve as a separate design and implementation project.
- Require enforceable liquidity buffers, loss containment, and proof that vesting obligations remain payable under strategy exit constraints.

## Security, reliability, and compliance requirements

- Treat payroll funds and yield positions as high-impact financial assets; contracts and integrations require independent security review before handling meaningful value.
- Define key ownership and recovery for business admins, employee wallets, and approval roles. Do not equate a lost wallet with a lost employment record.
- Enforce least privilege, transaction previews, approval thresholds, replay-safe operations, and tamper-evident audit records.
- Reconcile indexed/application state to canonical chain state; show stale or unavailable reads as such and never silently substitute cached values as live.
- Define pause, incident, recovery, and support procedures before production launch.
- Research applicable payroll, employment, tax, privacy, and financial-product obligations for the launch jurisdictions before offering the service. Jurisdiction and legal model are not yet chosen.
- Do not promise yield, uninterrupted RPC availability, instant exits, or legal/tax treatment that has not been validated.

## Success criteria

- A small business can onboard a team, prepare and approve payroll, fund streams, and inspect a complete auditable history.
- Each employee can independently verify live vested pay and claim a partial amount while streaming continues.
- Funding forecasts and alerts identify underfunding risk early enough for the employer to act.
- Role checks and approvals prevent unauthorized payroll changes and produce understandable records.
- Employee yield is explicitly opt-in, based only on vested unclaimed salary, and accurately separates principal, yield, fees, and exit state.
- Strategy unavailability or delay is shown honestly and cannot corrupt salary accounting.
- Employer-reserve yield remains out of release scope until upcoming payroll obligations are protected by enforceable liquidity and loss controls.

## Decisions still required

- Initial launch jurisdiction(s), legal operating model, and supported payroll/tax scope.
- Whether payroll is MON-only initially or needs stable-value assets for predictable compensation.
- Organization identity and wallet custody/recovery model.
- Approval policy defaults and who may execute on-chain transactions.
- Employee claim model: fully manual, optional recurring claim, or employer-defined scheduling.
- Yield protocol, custody model, strategy controls, fees, exit timing, and loss allocation.
- Backend/indexer and operational hosting choices, including availability and data-retention expectations.

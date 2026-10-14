# FlowPay Team Payroll Foundation — India v1 Design

## Status

Product-owner approved subsystem design based on the hybrid SaaS architecture. India counsel and payout-provider review remain required before any production wage calculations or live bank payouts.

## Goal

Let an Indian small business manage a team, prepare and approve a payroll run, let employees see an estimated INR earning balance accrue continuously, and permit employee-initiated partial claims that auto-pay only within employer-approved limits. Keep payroll funds in the employer's account and use a reviewed provider to pay employees directly. FlowPay keeps a private application ledger and reconciles provider outcomes.

This is a payroll workflow and earned-pay access design. It does not claim that a continuous accrual or early claim is legally treated as wages, an advance, or a compliant statutory payroll payment; counsel must determine this before launch.

## Out of scope

- FlowPay custody or pooling of employer payroll money.
- Production payout-provider selection, credentials, or live transfers.
- Hard-coded Indian statutory tax, benefit, overtime, leave, or minimum-wage formulas without a validated rules source and maintained update process.
- MON or stable-token wage settlement, public payroll data, or production chain writes for INR balances.
- Either yield pool, savings/yield integrations, and employer reserve yield.
- Payroll execution with a single-person approval bypass; the exception policy for one-operator businesses is still an owner decision.

## Users and authority

- **Organization owner:** creates a workspace and proposes membership/policy changes.
- **Payroll operator:** manages employee/compensation inputs and prepares payroll runs.
- **Payroll approver:** a different authorized wallet approves payroll runs and sensitive employee/pay changes (maker-checker default).
- **Payout executor:** submits approved instructions to a provider under employer authority; its exact implementation is open. It cannot change an approved run.
- **Employee:** views their own earnings and claims, submits eligible partial claims, updates payout details through a separately verified procedure, and views payslips/history.
- **Recovery guardian/quorum:** restores a user's wallet authority under its wallet mechanism. Guardians do not automatically receive organization membership or payroll approval authority.
- **FlowPay support/operator:** operational access is narrow, time-limited, logged, and cannot approve payroll or change payout destinations.

Wallet-only authentication is selected. Legal identity and employee records are private application data linked to authorized wallet membership; the wallet address is not legal identity proof. Organization creation and additional admin-wallet governance need a defined policy before implementation is finalized.

## Core data concepts

All currency amounts use integer paise. Never use JavaScript floating point for persisted payroll or claim amounts.

- **Organization** — tenant, employer profile, status, payroll timezone, policy versions, and membership.
- **Wallet membership** — organization, wallet address, role grants, effective dates, inviter, and revocation events.
- **Employee** — private employee/employment record, active dates/status, wallet links, and payout-provider recipient reference. Avoid storing raw bank credentials if a provider token/reference suffices.
- **Compensation term** — employee, currency INR, gross/base and configurable component references, pay period, effective start/end, source, and approval event. Compensation history is immutable; new terms supersede at a declared effective time.
- **Payroll period/run** — period boundaries, input snapshot, calculation-rule version, preview totals, preparer, separate approver, approved snapshot hash/reference, and status.
- **Earning entry** — append-only amount in paise, employee, period, effective timestamp/range, source term/rule version, entry type, and reversal/adjustment link.
- **Claim** — employee, requested amount, policy version, available-balance reservation, eligibility decision, approval/auto-approval reason, and state.
- **Payout attempt** — provider, stable idempotency key, provider reference, amount/recipient token, attempt state, timestamps, webhook evidence, and reconciliation state.
- **Audit event** — actor wallet, organization, action, target, request/correlation ID, and immutable references to before/after snapshots. Do not publish PII, salary values, or wallet-to-employee mappings on-chain.

## Earning and claim accounting

- The UI shows an **estimated accrued amount**, with the current period, calculation basis, last-updated time, and any stale/unavailable state. It does not state that money has settled or that each second caused a bank or chain transaction.
- A versioned payroll calculation policy determines which scheduled seconds count, how pay-period boundaries and approved changes work, and how rounding remainders are carried. Statutory details are injected through a reviewed rules provider; an unvalidated formula cannot mark payroll “compliant.”
- Each payroll preview captures compensation terms, effective dates, input data, and rule version. Approval binds to that immutable snapshot. A changed input requires a new preview and approval.
- Claimable balance = accepted accrued entries and adjustments minus successful claims, active reservations, holds, and other policy-defined deductions. This is a projection of append-only events, not an editable balance field.
- An employee submits a claim only for their available balance. The policy determines the maximum amount/frequency and whether the request is in policy. Eligible claims are auto-authorized under the selected employer policy; exceptions require a different authorized approver.
- A claim reservation and durable payout command are written atomically with a stable idempotency key. Provider timeout/ambiguous state must be reconciled before retry to avoid duplicate payments.
- A successful payout becomes a paid claim and offsets the payroll-period net amount exactly once. Failed/returned transfers produce explicit compensating entries after provider confirmation. Never silently erase a failed payout or make an unresolved amount claimable twice.
- Provider execution is asynchronous. The product shows requested, awaiting approval, queued, submitted, paid, failed, returned, reversed, and reconciliation-required states as appropriate; it never reports confirmed receipt before provider evidence supports it.

## Payroll workflow

1. Owner sets the organization policy and appoints separate preparer/approver wallets.
2. Operator adds employees, compensation terms, and effective dates. Sensitive changes enter a pending state until separately approved.
3. At a configured period boundary, the operator prepares a payroll run. Inputs and rules are versioned; missing/changed inputs are visible.
4. The system previews gross pay, component lines, prior claims, deductions, net amounts, employer liabilities, and funding/payout totals. Unknown/unsupported rules block approval instead of being silently omitted.
5. A different wallet reviews the diff and approves the exact snapshot. Approval expires if that snapshot changes.
6. Claims continue under policy during the period. The payroll run reconciles paid claims and shows failed, returned, or unresolved payouts explicitly.
7. The final period close records payslip/export artifacts and a reconciliation result. Corrections append a linked adjustment run; closed history is not rewritten.

## Provider boundary

Define a narrow interface such as `createPayout`, `getPayoutStatus`, `verifyWebhook`, and `listSettlements`. Provider-specific statuses and errors map into FlowPay's state machine. The employer must authorize the provider to debit/pay from its own account. Keep credentials server-side and scoped to the tenant/provider setup; never ship them to the browser. A local fake provider may be used for development, but must be visibly marked and must not represent a real payout.

Before selecting/implementing a real provider, confirm account ownership and authorization, recipient onboarding, supported transfer modes, payout cutoffs, reversals/returns, idempotency, webhook authenticity, reconciliation reports, fees, service levels, data handling, dispute support, and Indian legal role with counsel.

## Privacy and security invariants

- Enforce tenant and employee scoping server-side for every read/write; never rely on a hidden UI control for access control.
- Wallet challenge uses a fresh, expiring nonce bound to the origin/domain; prevent replay. Sessions are short-lived and revocable. Do not request seed phrases/private keys.
- Maker and checker are different active wallets for each payroll run and sensitive compensation/payout-detail change. Recovery guardians do not satisfy the checker requirement by default.
- Payout destination changes are high risk: pause new claims until verified/approved under a separately reviewed process; notify affected employee through an independent channel if one is designed and approved.
- No PII, salary, bank details, claim events, or identity links on a public chain. Redact secrets and PII from logs; restrict and audit support access.
- Every money-affecting command is idempotent and leaves an auditable event. Access revocation takes effect immediately for new commands and sessions.

## Required acceptance behavior

- A compensation change cannot apply retroactively to a closed/approved period; its effective time and approver are visible.
- A payroll run cannot be approved by the wallet that prepared it, and any snapshot change invalidates prior approval.
- A claim cannot exceed the available amount or be reserved twice under concurrent requests.
- Duplicate client retries and duplicate webhooks do not cause duplicate payouts or ledger entries.
- Unknown provider state is held for reconciliation, not retried as a fresh payout.
- A successful payout is offset exactly once in period close; failed/returned payout accounting is recoverable and auditable.
- Unauthorized organization access, employee cross-reads, revoked wallets, expired challenges, and replayed signatures are rejected.
- Live accrual is labeled as an estimate, reflects the selected effective-dated policy, and displays stale state when its source inputs are unavailable.
- No UI or report claims statutory compliance until the selected payroll rules and provider workflow have been validated by qualified specialists.

## Open decisions retained

- Exact Indian legal treatment and operating scope for early wage claims; counsel approval.
- Payout provider, employer authorization/debit mechanism, fees, timing, and service levels.
- Payroll rules source and maintained calculation scope, including state/employer-specific applicability.
- Organization wallet governance, role matrix, approval thresholds, executor, and one-operator exception.
- Supported wallet/guardian combinations and verified employee wallet-link/reassignment process.
- Hosting, data residency/retention, availability objectives, backups, and support schedule.
- Employee claim caps, frequency, fees, per-day/month limits, and payout cutoffs.

## Required review gate

Before implementation of any real payroll calculation or payout integration, the product owner reviews this subsystem design and qualified Indian payroll/legal specialists validate the intended operating model. Provider connection and production execution are separate gates from local domain implementation.

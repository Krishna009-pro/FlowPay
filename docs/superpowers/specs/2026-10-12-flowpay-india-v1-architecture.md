# FlowPay India v1 System Architecture Proposal

## Status

Hybrid payroll SaaS architecture selected by the product owner on 12 October 2026. This is not a production-readiness claim. It assumes the selected product decisions in [the launch decision register](./2026-10-11-flowpay-launch-decisions.md) and [the payroll product design](./2026-10-11-flowpay-small-business-payroll-design.md). The team-payroll subsystem spec is a separate review gate before its detailed implementation plan and code.

## Agreed product constraints

- First market: India.
- Payroll accounting and salary accrual: INR.
- Claims: employee-initiated partial claims; claims within employer policy may be paid automatically, exceptions require approval.
- Payment direction: employer-owned funds go directly from the employer's account through a reviewed provider to employees; FlowPay does not pool/custody payroll funds. Counsel and provider review remain required.
- Authentication: wallet-only; user-controlled guardian/quorum recovery; FlowPay never holds wallet keys.
- Payroll approvals: maker-checker by default; payout executor, approval thresholds, and tiny-team exception rules remain open.
- Yield is excluded from v1. The current Monad Testnet contract remains a demo/prototype.

## Strategic consequence

This v1 is a payroll SaaS product with INR accounting and bank/electronic payouts. Monad is not the production salary settlement rail in this design. Keep the existing Monad demo isolated and behind a future settlement adapter. Do not add an on-chain transaction for every accrual tick or publish employee compensation, claims, wallet-to-employee mapping, or bank data on-chain.

That reduces the direct “why Monad” story for India v1. Wallet login and guardians can be chain-compatible without settling payroll on Monad. A production Monad role should be added only if it solves a clear user need and passes legal, privacy, security, and operating review.

## Architecture options

### A. Hybrid payroll SaaS (recommended)

React application + modular backend + relational payroll/claim ledger + background payout/reconciliation worker + provider adapter. Keep the production payroll source of truth off-chain and private; use the wallet for authentication and explicit authorization. The chain adapter is disabled for production INR payroll until a separate decision.

**Benefits:** supports private employee records, exact payroll audit/history, asynchronous bank payouts, retries and reconciliation; avoids designing payroll correctness around public-chain writes; allows the existing UI to be reused selectively.

**Costs:** loses an on-chain production settlement demo in the India v1; requires backend operations, secure employee-data storage, provider contracts, and counsel review.

### B. On-chain-first payroll

Put payroll stream accounting and claims on Monad, then add an off-chain provider to convert/settle INR claims.

**Benefits:** strongest direct Monad story and public settlement proofs.

**Costs:** creates a public/private dual ledger for every payroll action; does not remove the bank payout integration; complicates reversals, identity privacy, user recovery, and wage-payment interpretation. This conflicts with the selected employer-funded direct INR payout model unless separately redesigned and legally reviewed.

### C. Microservices from launch

Split identity, payroll, ledger, claims, payouts, notification, and reporting into separately deployed services.

**Benefits:** independent scaling and deployment boundaries.

**Costs:** substantially more operational complexity before product scale; cross-service transactions make payroll claims, approvals, and payout reconciliation harder to reason about.

## Proposed system boundaries

```text
Employer / employee web app
        |
        | wallet challenge + signed request; short-lived app session
        v
FlowPay API (modular monolith)
  | Organization & wallet membership
  | Employee / compensation records
  | Payroll rules adapter & immutable run snapshots
  | INR earning/claim ledger
  | Maker-checker approvals & audit log
  | Provider integration API
        |
        +--> PostgreSQL (private records, ledger, audit, outbox)
        |
        +--> Durable worker (payout dispatch, provider webhooks,
        |                   retries, reconciliation, notifications)
        |
        +--> Employer-authorized bank/payment provider
        |      (employer account -> employee account)
        |
        +--> Monad Testnet adapter (demo only; separate data boundary)
```

Start with one backend deployable and one database, with explicit internal module interfaces. Use background jobs for provider calls, webhooks, and reconciliation; do not hold an HTTP request open while waiting for bank settlement. Avoid microservices until independent scale or ownership boundaries justify them.

## Core domain and records

- **Organization:** employer workspace, legal/display data, policy, payroll calendar, and status.
- **Wallet membership:** wallet address, organization, role, activation/revocation dates, and authorization history. Never treat an address alone as verified legal identity.
- **Employee record:** private identity/employment/payout-provider references, effective-dated compensation terms, status, and authorized wallet links. Store provider tokens rather than raw bank credentials where the provider supports it.
- **Payroll rule version:** source/provider, effective dates, inputs, outputs, and reviewer; no silent change to a rule version used for an approved payroll run.
- **Payroll run:** immutable prepared snapshot, rule version, period, gross/net/liability lines, maker, checker, approval time, payout references, and correction links.
- **Earning/claim ledger:** append-only signed amounts in paise, source period, employee, event type, effective time, idempotency key, and any reversal/adjustment reference. Balances are projections of entries, not hand-edited fields.
- **Claim and payout attempt:** requested amount, eligibility/reservation, approvals or policy authorization, provider idempotency key, provider reference, state transitions, timestamps, and reconciliation result.
- **Audit event:** actor wallet, organization, action, before/after references, request ID, decision, and time. Do not put PII, compensation values, bank references, or employee mappings on a public chain.

## Critical workflows

### Prepare and approve payroll

1. Payroll operator imports or enters period inputs and compensation changes.
2. Server calculates a versioned preview and highlights changed values, missing data, and payout needs.
3. A different authorized wallet reviews and approves the immutable payroll snapshot.
4. Approved records become the period baseline. Corrections append adjustment records; they do not rewrite the approved history.

### Accrue and claim earnings

1. The system projects INR earnings from approved compensation terms and the selected payroll-rule version, using server time and explicit period boundaries.
2. Show live accrual as an estimate and identify its calculation basis. Never imply a blockchain transaction occurred for each tick.
3. On claim, atomically validate the employee's available amount and employer policy, reserve the amount once, and write the request plus a durable outbox message.
4. The worker sends the payout instruction using a stable idempotency key. Eligible in-policy claims proceed automatically; exceptions wait for a separate authorized approver.
5. Provider callbacks and reconciliation move the claim to paid, failed, returned, or reversed. The ledger gets compensating entries for changes; an ambiguous provider timeout is reconciled before retry.
6. The period payroll offsets successful claims exactly once. Failed or returned transfers release/reinstate the claimable amount only after provider state is known.

### Recover a wallet

Wallet recovery is performed by the user's selected guardian/quorum mechanism, outside FlowPay custody. FlowPay records authorized membership changes and re-authenticates with the restored wallet. Payroll approval rights remain separate from guardianship. Supported wallets and recovery compatibility require a production support matrix.

## Reliability and security properties

- Use a transactional database write plus outbox record before dispatching provider work; every provider operation has an idempotency key.
- Track claim and payout states explicitly. Never turn timeout or missing webhook into a success/failure guess; reconcile with provider before another payment attempt.
- Enforce organization-scoped access on every query and command; separate preparer, approver, executor, and support privileges.
- Use nonce-based wallet challenges, expiry, domain/origin binding, and replay protection; issue short-lived, revocable sessions. Do not ask a wallet to sign ambiguous transaction text.
- Encrypt sensitive records in transit and at rest, minimize stored bank data, keep secrets outside source control, redact logs, and audit staff access.
- Apply daily backups, restore drills, provider webhook signature validation, rate limits, incident controls, and reconciliation alerts before launch.
- Treat cached live accrual as a projection; disclose stale data and reconcile backend projections to approved payroll and provider records.
- Require independent review of the claim state machine, payroll calculations, privacy controls, and payout integration before production use.

## Decisions still needed before implementation details are frozen

- Product-owner architecture approval: hybrid SaaS, on-chain-first, or microservices.
- Indian counsel's opinion on FlowPay's role, employer/provider contracts, wage-access claims, tax/payroll reporting, privacy roles, and payment instructions.
- Payout provider and its authorization model, onboarding, webhooks, idempotency support, payout cutoffs, returns, fees, and service levels.
- Organization wallet governance, role matrix, approval thresholds, payout executor, and single-operator exception.
- Supported wallet/recovery list and wallet-to-employee reassignment policy.
- Claim limits, eligibility/caps, settlement timing, employee/employer fees, and disclosure language.
- Hosting, data residency/retention requirements, availability and recovery objectives, and support operations.
- Payroll rules partner/scope and an independently validated calculation test corpus.

No production claim, legal conclusion, payout provider, cloud region, tax rule, or chain role is assumed by this proposal.

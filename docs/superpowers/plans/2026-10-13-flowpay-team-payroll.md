# FlowPay India Team Payroll — Implementation Plan

> Product-owner approved for local synthetic implementation. Do not connect a live payout provider, process real payroll, deploy a contract, or handle real payroll funds in this plan.

**Goal:** Build the first local end-to-end hybrid payroll slice for the approved India v1 design: wallet-authenticated organization access, private employee/compensation records, INR earning ledger, maker-checker payroll approval, employee-initiated claims, automatic in-policy claim dispatch through a fake provider, and reconciliation-safe states.

**Design:** `docs/superpowers/specs/2026-10-12-flowpay-team-payroll-design.md`

**Architecture:** `docs/superpowers/specs/2026-10-12-flowpay-india-v1-architecture.md`

**Technology proposal:** Continue the repository's Node ESM/JavaScript conventions; add Fastify 5 for the API, PostgreSQL 18 with `pg` for persistence, explicit SQL migrations and queries, and a durable outbox worker. Keep React/Vite and viem. Do not add an ORM to the money ledger in the first slice; explicit SQL transactions and row-level locking make reservation/idempotency behavior inspectable. Node 24 is the local runtime. Resolve dependency versions into `package-lock.json` during implementation.

Fastify 5 documentation lists Node.js 20+ support and JSON-schema request/response validation. Node-postgres transaction guidance requires all statements in a transaction to use the same checked-out client. PostgreSQL supports row-locking reads for concurrent updates. See [Fastify v5 migration guide](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/), [node-postgres transaction guide](https://node-postgres.com/features/transactions), and [PostgreSQL SELECT locking clauses](https://www.postgresql.org/docs/current/sql-select.html).

## Safety boundaries

- The current app/contract remain a Monad Testnet demonstration; no production chain writes.
- Use synthetic organizations, employees, amounts, and provider responses only.
- A fake payout provider must be visibly labeled and cannot contact a bank or payment network.
- Statutory India payroll/tax formulas remain behind a versioned rules interface; unconfigured rules block payroll approval rather than silently returning a compliant-looking result.
- The local slice does not decide the real provider, employer authorization, country/state payroll coverage, production wallet matrix, hosting region, availability target, or data retention policy.
- No keys, bank credentials, PII, or real payroll files may be checked into the repository or written to logs.

## Implementation sequence

### Task 1: Backend and Postgres development harness

**Files:** create `server/`, `server/test/`, `server/db/migrations/`, `docker-compose.yml`, and test/dev scripts in `package.json`.

1. Add a failing API smoke test for `GET /health` and a database readiness test that distinguishes “API alive” from “database ready.”
2. Add a PostgreSQL 18 local service with health checks and a disposable test database. Keep credentials in ignored local environment configuration; `.env.example` contains placeholders only.
3. Add Fastify server factory and startup entrypoint with explicit config validation, request IDs, JSON schemas, structured redacted logging, and graceful shutdown.
4. Add a small SQL migration runner that records applied migration IDs and serializes concurrent migration startup; keep SQL migration files checked in.
5. Run the smoke/readiness tests and verify the existing Vite app and contract suites still build/run.

**Acceptance:** Developers can start an isolated local API and database without modifying the existing Testnet config; liveness and readiness report separately; startup fails closed on missing required configuration.

### Task 2: Money and earning-ledger domain primitives

**Files:** create `server/src/domain/money.js`, `earning.js`, `ledger.js`, and unit tests beside each module.

1. Write failing tests for INR parsing/formatting in integer paise; reject float, negative, exponent, excessive precision, and unsafe integer inputs.
2. Write failing tests for effective-dated compensation terms, period boundaries in `Asia/Kolkata`, and rate-change checkpoints.
3. Define accrual as a deterministic projection with an injected clock and versioned policy input. Carry fractional remainder explicitly; never round each second independently.
4. Write tests for ledger projections: approved accrual/adjustments increase available earnings; reservations reduce availability; paid claims offset exactly once; reversals use compensating entries; duplicate idempotency keys have no second effect.
5. Implement the pure functions and document that results are estimates until Indian payroll specialists approve the policy semantics.

**Acceptance:** Currency arithmetic is integer-only; projections are deterministic from recorded inputs; no test depends on wall-clock sleeps or RPC.

### Task 3: Persistence schema and tenant-safe repositories

**Files:** SQL migrations for organizations, wallet memberships, employees, payout recipient references, compensation terms, payroll periods/runs, approvals, earning ledger, claims, payout attempts, outbox, sessions/nonces, and audit events; repository modules and Postgres integration tests.

1. Write failing integration tests proving every tenant-owned row is scoped to an organization and inaccessible across organizations.
2. Write tests for foreign keys, unique membership/approval constraints, append-only ledger/audit writes, effective-date checks, integer paise columns, and idempotency-key uniqueness.
3. Add repository functions using parameterized SQL and explicit transactions. Avoid accepting organization IDs as trusted authority without deriving membership from the authenticated session.
4. Add concurrent claim-reservation tests against real Postgres: two simultaneous requests for one employee cannot reserve more than the available balance.
5. Add append-only enforcement for ledger/audit rows and provide correction/reversal entry types instead of update/delete paths.

**Acceptance:** Database constraints reinforce domain invariants; concurrency tests pass against Postgres, not only mocks; no cross-tenant data access.

### Task 4: Wallet challenge authentication and organization access

**Files:** auth challenge/session modules, organization/member services, API routes, frontend wallet session state, tests.

1. Write failing tests for one-time challenge issue/consume, expiry, origin/domain binding, replay rejection, revoked sessions, and invalid signatures.
2. Define a signature-verifier port. Implement EOA verification using existing viem; keep contract-wallet/EIP-1271 verification behind the port until the supported wallet and verification-chain matrix is chosen. Do not claim every wallet is supported.
3. Store only a hash of each one-time challenge and hash of each opaque session token. Set session cookies HttpOnly, Secure in production, SameSite, short-lived, and revocable; enforce CSRF/origin protections for state-changing routes.
4. Write tests for organization-scoped role checks and distinct maker/checker wallets. Recovery guardians never implicitly become members or approvers.
5. Add organization create/invite/revoke flows that bind a wallet to an organization only after a valid signature and authorized invitation.

**Acceptance:** Replayed/expired signatures and revoked sessions fail; signatures cannot cross domains; unauthorized or cross-tenant routes fail closed; no wallet keys are received or stored.

### Task 5: Employee, compensation, payroll preview, and maker-checker

**Files:** employee/compensation/payroll services, routes, migrations, tests, and minimal employer UI.

1. Write failing tests for employee creation, active/effective dates, wallet linkage, sensitive payout-detail changes, and compensation history.
2. Add effective-dated compensation updates that require maker-checker approval and cannot rewrite closed/approved periods.
3. Build payroll preview snapshots from configured input data and a versioned calculation policy. If no approved policy is configured, show unsupported/missing rules and block final approval.
4. Write tests that only a different active authorized wallet can approve a payroll snapshot; any change to the snapshot invalidates prior approval.
5. Add minimal create/list/detail/preview/approve UI; keep private employee data scoped and avoid putting it in URLs/logs.

**Acceptance:** The approved payroll record is immutable and auditable; the UI never labels unvalidated calculations “compliant”; all sensitive changes show pending/approved/rejected state.

### Task 6: Claim policy, reservation, fake payout, and reconciliation

**Files:** claim and payout state machine, outbox worker, fake provider, webhook/reconciliation routes, tests, and employee claim UI.

1. Write failing tests for claim eligibility, employer policy caps, auto-authorization within policy, escalation outside policy, insufficient/held balances, and concurrent requests.
2. In one database transaction, validate available balance, reserve the claim, record the policy decision, and create a durable outbox command with an idempotency key.
3. Implement a fake provider with deterministic success, pending, timeout, failure, return, duplicate callback, and reversal scenarios. It must be impossible to configure a real provider through these test settings.
4. Write failing tests for idempotent dispatch, signed callback validation boundary, ambiguous timeout reconciliation before retry, exactly-once payroll offset, and compensating entries on provider-confirmed return/reversal.
5. Add an operator reconciliation view and employee claim history that distinguish requested/queued/submitted/paid/failed/returned/reversed/reconciliation-required. A payout is not “received” until provider evidence supports it.

**Acceptance:** No duplicate payout or double-spend under retries/concurrency; uncertain provider outcomes are held for reconciliation; fake provider is explicit in UI and logs; no network payout integration exists.

### Task 7: Review, documentation, and gated handoff

1. Add a synthetic end-to-end scenario from org setup through payroll approval, accrual projection, employee claim, fake-provider settlement, and period reconciliation.
2. Run focused unit/integration/security cases, full `npm test`, production build, dependency audit, and `git diff --check`.
3. Review the full tenant access, wallet challenge, maker-checker, ledger immutability, outbox, idempotency, and payout-state diffs before handoff.
4. Update README with local dev/test commands, fake-provider warning, architecture boundaries, and explicit non-production status.
5. Stop before choosing a real payout provider, implementing jurisdiction-specific statutory calculations, collecting real PII, deploying, or processing funds. Record those as separate approval/review gates.

**Acceptance:** A local synthetic flow demonstrates the product workflow while all real money, statutory, provider, production hosting, and chain settlement gates remain closed.

## Approval gate

Review this plan together with `docs/superpowers/specs/2026-10-12-flowpay-team-payroll-design.md`. Implementation may start only after plan approval. User's prior request authorizes the project work, but does not remove the existing project roadmap's reviewed-plan gate. Provider selection and legal review are not required to implement the isolated local/fake-provider slice; they remain required for production payout or payroll-compliance claims.

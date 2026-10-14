# FlowPay Payroll System Roadmap Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for this staged roadmap. Each product subsystem must receive its own reviewed design and implementation plan before code work begins.

**Goal:** Evolve the current single-stream Monad Testnet prototype into a small-business payroll system with team management, per-second pay, employee-earned-pay yield first, and a separately gated employer-reserve yield phase.

**Architecture:** Preserve the current prototype as a reference while verifying its deployed configuration and capturing its accounting behavior. Decompose the product into independently reviewable workstreams for payroll foundation, employee yield, and employer-reserve yield. Do not choose production backend, identity, custody, or strategy interfaces until the open product and jurisdiction decisions are resolved in the relevant subproject designs.

**Tech Stack:** Existing prototype: React 18, Vite 6, viem, Solidity 0.8.28, Monad Testnet. Production application, indexing, identity, custody, payroll asset, and yield strategy choices remain open and must be settled by the design gates below.

**Spec:** `docs/superpowers/specs/2026-10-11-flowpay-small-business-payroll-design.md`

## Global Constraints

- The existing single-stream Testnet contract is immutable prototype/legacy state; do not represent it as the production architecture.
- Do not broadcast deployments or payroll transactions as part of local implementation work.
- Never place private keys or seed phrases in browser code, Vite variables, committed files, or logs.
- Keep employee-owned vested salary separate from employer-owned unvested payroll reserve.
- Employee yield is opt-in and applies only to vested, unclaimed salary in its first release.
- Employer-reserve yield is a separate later phase and cannot ship until payroll liquidity and loss controls are enforceable and independently reviewed.
- Display variable yield as variable; never promise an APY, instant exit, or guaranteed return.
- Do not make jurisdiction-specific payroll, tax, employment, privacy, or financial-product claims until launch jurisdictions and operating model are selected and reviewed.

## Review Focus

1. **Conflicting contract addresses or deployment blocks:** verify on-chain identity and ownership before changing public setup configuration; never infer the canonical deployment from one stale file.
2. **Savings versus yield accounting:** preserve current savings as a non-yield reserve and keep future strategy principal/yield accounting separate.
3. **Payroll lifecycle changes:** explicitly define effective times for salary changes, pause/resume, and employment termination so vested compensation is neither lost nor retroactively altered.
4. **Yield exit delay or loss:** employee claims and employer vesting must expose and respect strategy liquidity; no silently unavailable funds.
5. **Wallet/account/indexer failure:** role-restricted actions must fail closed and stale or unavailable reads must be labeled, not silently presented as live.

---

### Task 1: Reconcile and label the current Testnet prototype

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `contracts/deploy.js` only after reviewing its current secret and `.env` write behavior
- Review: `contracts/out/deployedAddress.json`, `src/chain/config.js`, tracked public configuration, and configured deployment values

**Interfaces:**
- Produces one verified canonical record: `{ chainId, contractAddress, deploymentBlock, employerAddress, verificationSource }`.
- No production settings may be changed based only on an unverified local artifact.

- [ ] **Step 1: Verify each candidate address on Monad Testnet** by reading bytecode, `employer()`, and `streamCreated()` from the RPC/explorer; record which candidate is the intended live demo contract and which are stale or unrelated.
- [ ] **Step 2: Compare the verified deployment with README, `.env.example`, deployment artifact, and local configuration without printing or committing `.env.local` contents.**
- [ ] **Step 3: Update public documentation and example values** to identify the app as a Testnet prototype and remove contradictory address/block references.
- [ ] **Step 4: Review deploy script behavior** so deployment cannot unexpectedly overwrite the root `.env` or expose a private key; document the safe command and public outputs.
- [ ] **Step 5: Inspect the diff** and verify no local environment or wallet secret file is staged.

**Acceptance:** A new developer can identify the configured prototype deployment and understand that the site is Testnet-only; public docs and examples do not disagree.

### Task 2: Capture contract invariants with regression coverage

**Files:**
- Create: contract test configuration and tests under `contracts/`
- Create: frontend/chain helper tests under `src/` or `tests/`, after selecting the lightest compatible runner
- Modify: `package.json` only for the selected test commands

**Interfaces:**
- Contract tests exercise the existing `FlowPay` public ABI and accounting without changing deployed behavior.
- Chain helper tests use an injected/mock provider and do not send real transactions.

- [ ] **Step 1: Add contract cases** for role restrictions, zero/invalid inputs, vesting caps, pause/resume checkpoints, top-up after exhaustion, savings-rate checkpoints/remainder, and independent claims.
- [ ] **Step 2: Add chain/UI behavior cases** for wrong chain, account changes, cancelled/reverted/pending transactions, stale reads, and honest empty activity.
- [ ] **Step 3: Run the new suites and build**; record commands and results in the README development section.
- [ ] **Step 4: Keep all tests local**; do not use funded wallets or broadcast to Testnet.

**Acceptance:** Current contract behavior has repeatable regression coverage before the architecture is replaced or extended.

### Task 3: Resolve product and launch decisions

**Files:**
- Create: `docs/superpowers/specs/2026-10-11-flowpay-launch-decisions.md`

**Interfaces:**
- Produces explicit decisions or clearly named decision owners for: launch jurisdiction/legal model, native MON versus stable-value compensation, organization identity and wallet recovery, role/approval defaults, claim scheduling, data retention/privacy, and target availability/support expectations.
- Each decision includes rationale, affected subsystem, and whether it blocks Phase 1 implementation.

- [ ] **Step 1: Record the business/customer assumptions** from the approved product brief without adding unsupported legal or compliance claims.
- [ ] **Step 2: Identify which open decisions change contract interfaces, backend data models, or user workflows.**
- [ ] **Step 3: Mark unresolved decisions as implementation blockers** rather than silently selecting defaults.
- [ ] **Step 4: Review the decision record** before commissioning any production identity, backend, or payment-asset implementation plan.

**Acceptance:** The architecture no longer depends on hidden assumptions about jurisdiction, asset denomination, identity, or key recovery.

### Task 4: Design the team payroll foundation as a standalone subproject

**Files:**
- Create: `docs/superpowers/specs/2026-10-11-flowpay-team-payroll-design.md`
- Create later: `docs/superpowers/plans/YYYY-MM-DD-flowpay-team-payroll.md`

**Interfaces:**
- Consumes: approved decisions from Task 3 and verified prototype behavior from Tasks 1–2.
- Produces: organization/employee model, role and approval policy, stream lifecycle semantics, multi-employee discovery, payroll preview/funding runway, audit history, notification/export boundaries, and migration/legacy handling.

- [ ] **Step 1: Define the business workspace and membership model**, including wallet changes and recovery.
- [ ] **Step 2: Define employee compensation records and stream lifecycle semantics**, including effective-dated rate changes, pause/resume, termination, and already-vested pay.
- [ ] **Step 3: Define payroll review, funding runway, approvals, audit events, alerts, and export requirements.**
- [ ] **Step 4: Select on-chain contract/factory, application API, event indexer, and storage boundaries based on approved decisions.**
- [ ] **Step 5: Specify failure behavior and testable acceptance criteria**, then review and approve this subproject spec before writing its detailed implementation plan.

**Acceptance:** The team-payroll work can be implemented and operated without depending on either yield phase.

### Task 5: Design employee earned-pay yield as an independent subproject

**Files:**
- Create: `docs/superpowers/specs/2026-10-11-flowpay-employee-yield-design.md`
- Create later: `docs/superpowers/plans/YYYY-MM-DD-flowpay-employee-yield.md`

**Interfaces:**
- Consumes: the team-payroll liability/accounting model from Task 4 and a selected strategy approved after due diligence.
- Produces: explicit opt-in/revocation, eligible vested-unclaimed balance, principal/yield/fee accounting, strategy adapter boundary, claim/exit behavior, disclosures, reconciliation, and recovery policy.

- [ ] **Step 1: Compare candidate strategy and custody models** against liquidity, loss, upgrade, admin-key, and withdrawal-delay requirements.
- [ ] **Step 2: Define how an employee liability remains payable while principal is allocated**, including partial claims and strategy failure/delay.
- [ ] **Step 3: Define UI disclosures and balances** so salary principal is distinct from realized/unrealized yield, fees, and exit status.
- [ ] **Step 4: Specify adversarial and accounting acceptance tests**, including opt-out, partial withdrawal, paused stream, strategy loss, and delayed exit.
- [ ] **Step 5: Obtain independent security review of the design and selected integration** before producing an implementation plan that moves funds.

**Acceptance:** The feature can be disabled or the strategy can fail without corrupting salary accounting or implying yield is guaranteed.

### Task 6: Consider employer-reserve yield only after explicit liquidity proof

**Files:**
- Create only after Phase 2 review: `docs/superpowers/specs/YYYY-MM-DD-flowpay-employer-reserve-yield-design.md`

**Interfaces:**
- Consumes: production payroll lifecycle from Task 4, employee-yield operational learnings from Task 5, and a formal payroll liquidity policy.
- Produces: enforceable liquidity buffer, loss containment, exit timing, funding-shortfall handling, and a separate test/security plan.

- [ ] **Step 1: Model all upcoming vesting obligations** under normal operation, top-ups, pause/resume, and employee claims.
- [ ] **Step 2: Prove that yield allocation cannot block or reduce vested salary or scheduled vesting** under documented strategy exit bounds and adverse conditions.
- [ ] **Step 3: Define employer opt-in, risk disclosures, and emergency unwind.**
- [ ] **Step 4: Stop the workstream if liquidity or loss guarantees cannot be enforced**; do not substitute a dashboard warning for a contract-level invariant.
- [ ] **Step 5: Commission independent review before any implementation or deployment plan.**

**Acceptance:** Employer-reserve yield remains deferred unless payroll obligations are protected by enforceable controls and independent review.

## Roadmap handoff

This is a phased roadmap, not authorization to deploy contracts or move funds. Tasks 1–3 establish reliable prototype facts and settle launch assumptions. Tasks 4–6 are separate subprojects; each requires user review of its design before its own detailed implementation plan. Phase 1 ships without yield; Phase 2 adds employee-earned-pay yield; Phase 3 remains gated by liquidity proof.

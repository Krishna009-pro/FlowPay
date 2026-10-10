# FlowPay End-to-End Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the FlowPay React demo with connected employer and employee flows, persistent simulated payroll state, and a distinctive payroll-product UI.

**Architecture:** Keep the current Vite + React single-page app. Put salary calculations, transitions, and local-storage handling in a small pure state module; keep screen composition and interactions in the React app. The same persisted state drives both views so employer controls immediately affect employee balances.

**Tech Stack:** React 18, Vite 6, lucide-react, browser localStorage, existing CSS.

**Spec:** `docs/superpowers/specs/2026-10-10-flowpay-end-to-end-design.md`

## Global Constraints

- Keep the demo to one employer, one employee, one currency, and one stream.
- Avoid adding a backend, authentication, wallet connection, smart contracts, external protocol integrations, or new dependencies.
- Mark every confirmation, activity item, network indicator, and explorer link as simulated or a demo placeholder where appropriate.
- Do not claim that idle yield is generated.
- Do not imitate Monad or Blitz branding, logos, signature color systems, or layouts.
- Use a restrained, work-focused visual language, clear hierarchy, realistic payroll details, and a small set of intentional colors.
- Avoid decorative gradients, glowing coins, excessive cards, vague AI-style copy, and unsupported claims.

## Review Focus

- Invalid or stale local-storage data must restore safe demo defaults.
- Repeated clicks or refreshes must not duplicate a withdrawal or activity event.
- A paused or underfunded stream must not accrue pay.
- A savings-rate change must not make spendable pay negative or retroactively remove recorded withdrawals.
- Funding and accrued-liability figures must stay consistent after withdrawals and new deposits.

---

## File map

- `src/flowpay-state.js` — default data, salary math, employer/employee actions, activity entries, and local-storage serialization.
- `src/FlowPayApp.jsx` — React app shell, role switch, employer and employee views, forms/modals, toasts, and state subscriptions.
- `src/main.jsx` — Vite entry point; render `FlowPayApp` and import global styles.
- `src/styles.css` — refreshed responsive styles for the employer and employee flows, retaining useful existing rules where they fit the approved visual direction.
- `docs/superpowers/specs/2026-10-10-flowpay-end-to-end-design.md` — approved behavior and UI constraints; do not change without revisiting the user.

## Task 1: Build the salary state and persistence module

**Files:**
- Create: `src/flowpay-state.js`
- Modify: `package.json` only if a dependency-free syntax check command is needed; do not add packages.

**Interfaces:**
- `createInitialState(now = Date.now()) -> FlowPayState`
- `loadState(storage = window.localStorage) -> FlowPayState`
- `saveState(state, storage = window.localStorage) -> void`
- `getSnapshot(state) -> { earned, availableToWithdraw, saved, withdrawn, escrowBalance, fundingForFutureAccrual, underfunded }`
- `advanceOneSecond(state) -> FlowPayState`
- `setStreamStatus(state, status, now = Date.now()) -> FlowPayState`
- `addFunding(state, amount, now = Date.now()) -> FlowPayState`
- `setSavingsRate(state, percent, now = Date.now()) -> FlowPayState`
- `withdraw(state, amount, now = Date.now()) -> { state, error }`

- [ ] Define a versioned state shape with `view`, `streamStatus`, `monthlyRate`, cumulative `deposits`, `elapsedSeconds`, `savingsRatePct`, `withdrawals`, and newest-first `activity`.
- [ ] Seed one coherent demo stream at `$3,200/month`, `$8,400` deposited, and `$1,240.50` earned, with stream status active and a savings rate of 10%.
- [ ] Implement `getSnapshot` using a 30-day month (2,592,000 seconds): cap gross earned at cumulative deposits; saved is gross earned times the savings rate; available is gross earned minus saved and withdrawals; escrow is deposits minus withdrawals; future accrual funding is deposits minus gross earned.
- [ ] Implement safe transitions for pause/resume, funding, savings changes (0–30% in 5-point increments), and withdrawals. The seeded stream is active; adding funds to an underfunded active stream allows accrual to continue. Reject non-finite, non-positive, or over-available withdrawals without changing state.
- [ ] Add an activity record for each successful action and no activity record for rejected actions.
- [ ] Load and save the versioned state in localStorage. If parsing, version validation, or storage access fails, use or retain safe defaults without crashing the page.
- [ ] Perform a focused manual calculation walkthrough for active accrual, capped funding, pause/resume, savings, and maximum/invalid withdrawals before wiring the UI.

## Task 2: Connect both role views to shared state

**Files:**
- Create: `src/FlowPayApp.jsx`
- Modify: `src/main.jsx`

**Interfaces:**
- Consumes all state functions from `src/flowpay-state.js`.
- Produces the default React component `FlowPayApp`.

- [ ] Render the existing visual shell with an obvious Employee / Employer view switch, and persist the selected view through the state module.
- [ ] Add a one-second active-stream update that stops cleanly while paused or underfunded, and persist the resulting elapsed time.
- [ ] Build the employee view with live earned, available, withdrawn, and saved amounts; savings-rate selection; withdrawal amount, MAX, and confirmation; and recent activity.
- [ ] Build the employer view with employee identity, monthly pay, deposited funds, escrow balance, funding available for future accrual, active/paused/underfunded status, pause/resume controls, add-funding form, and recent activity.
- [ ] Add consistent confirmation and error feedback. Label transaction confirmations and explorer/network placeholders as simulated.
- [ ] Keep forms keyboard-operable, label inputs, disable unavailable actions, and close dialogs on Escape.

## Task 3: Apply the approved visual direction responsively

**Files:**
- Modify: `src/styles.css`
- Modify: `src/FlowPayApp.jsx` only for semantic markup required by layout or accessibility.

- [ ] Remove the old crypto-dashboard cues that conflict with the spec, including the Monad testnet pill, decorative token/orbit art, faux growth percentage, and misleading yield status.
- [ ] Establish a restrained payroll-product palette and typography with realistic labels, data hierarchy, and clear active/paused/underfunded states.
- [ ] Style the employer and employee layouts, action forms, activity list, confirmations, and navigation using reusable CSS classes rather than one-off visual effects.
- [ ] Verify desktop and narrow-screen layouts manually at approximately 1440px and 390px widths; ensure controls remain visible and usable without horizontal overflow.

## Task 4: End-to-end manual walkthrough

**Files:**
- No new files; adjust the implementation files above for any issue found.

- [ ] Walk through employer view switching, pausing, resuming, and adding funds; confirm the shared employee view updates and funding caps accrual.
- [ ] Walk through employee live accrual, changing the savings rate, a valid withdrawal, MAX withdrawal, and rejected excessive withdrawal.
- [ ] Refresh after actions and confirm the selected view, balances, stream status, and activity persist.
- [ ] Confirm all displayed transactions are clearly simulated, no Monad or Blitz branding remains, and the page remains usable on desktop and mobile widths.

## Self-review notes

- Spec coverage: employer controls and funding are covered in Task 2; employee counter, savings, and withdrawal in Task 2; formulas and persistence in Task 1; responsive and distinct styling in Task 3; simulated-action transparency in Tasks 2–4.
- Step scan: each checkbox names a specific state, interface, screen, style, or manual walkthrough outcome.
- Type consistency: all React actions consume the state module's immutable state transitions; withdrawal alone returns `{ state, error }` to expose validation without throwing.
- Review focus: invalid storage is covered in Task 1; duplicate withdrawal behavior is prevented by state transitions and reviewed in Task 4; paused/underfunded accrual in Tasks 1–2; savings and withdrawal consistency in Task 1; funding arithmetic in Tasks 1 and 4.
- Proportion: the plan stays limited to the one-stream front-end demo and introduces no new integration or service.

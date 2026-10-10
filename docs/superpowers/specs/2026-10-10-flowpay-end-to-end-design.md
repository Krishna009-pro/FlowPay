# FlowPay End-to-End Demo Design

> **Superseded:** This earlier design described simulated-only interactions. The approved real-transaction scope is now in `2026-10-10-flowpay-onchain-design.md`.

## Goal

Turn the existing React/Vite salary dashboard into a complete, beginner-friendly hackathon demo. The core story is that an employer funds and controls a salary stream while an employee watches earned pay accrue, reserves a portion for savings, and withdraws available funds.

This is a front-end demonstration. It must not imply that a wallet, smart contract, Monad transaction, or yield protocol is connected.

## Users and views

- **Employer:** manages one employee stream, sees funding and stream status, and can start, pause, resume, or add demo funding.
- **Employee:** sees the live earned, available, withdrawn, and saved amounts; changes the auto-save percentage; and submits a simulated withdrawal.

The app should let the user switch between these views without signing in. The selected view and demo state should survive refreshes in the same browser.

## Main flows

### Employer

1. Review the employee, monthly pay rate, funded amount, and remaining payroll balance.
2. Start the stream if it is stopped, pause it while active, or resume it while paused.
3. Add demo funding and see the available payroll balance update.
4. Review the recent stream and funding activity.

Accrual advances only while the stream is active. Pausing freezes elapsed accrual; resuming continues from the same earned total. The available funding amount must not be presented as unlimited.

### Employee

1. See accrued salary update in real time while the stream is active.
2. Set an auto-save percentage from 0% through 30% in 5% increments.
3. Review the resulting earned, saved, withdrawn, and spendable amounts.
4. Enter a withdrawal amount, use a max shortcut, and confirm it. Reject zero, negative, malformed, or above-available amounts. On confirmation, update balances and activity immediately and show that this is simulated.

## State and calculations

Keep the demo to one employer, one employee, one currency, and one stream. Store stream status, rate, cumulative deposits, accumulated elapsed time, savings percentage, saved amount, withdrawals, activity entries, and selected view in browser local storage. Handle missing or invalid stored data by restoring safe demo defaults.

Calculate accrued pay from elapsed active time and the configured monthly rate. Cumulative gross accrual cannot exceed cumulative employer deposits; stop accrual and show an underfunded state when the available funding cannot cover the next increment. Employer funding available for future accrual is cumulative deposits minus gross accrual. The escrow balance shown to the employer is cumulative deposits minus withdrawals. Savings are an accounting allocation, not a second transfer. Spendable pay is gross accrued pay minus the saved allocation and prior withdrawals; it cannot be negative. Pausing accrual must not pause unrelated UI updates.

## Feedback and transparency

- Show active, paused, and underfunded states clearly.
- Add activity rows for stream start/pause/resume, funding additions, savings-rate changes, and withdrawals.
- Mark every confirmation, activity item, network indicator, and explorer link as simulated or a demo placeholder where appropriate.
- Do not claim that idle yield is generated. If retained from the current screen, present it as illustrative only; it is not part of the functional scope.
- Give users clear success/error feedback for actions and prevent invalid actions in the UI.

## Visual and technical approach

Keep the current React + Vite stack and lucide icon set. Refresh the current screen so it feels like a credible, distinctive payroll product rather than a crypto-project landing page or a generic AI-generated dashboard. Do not imitate Monad or Blitz branding, logos, signature color systems, or layouts. Use a restrained, work-focused visual language, clear hierarchy, realistic payroll details, and a small set of intentional colors. Avoid decorative gradients, glowing coins, excessive cards, vague AI-style copy, and unsupported claims. Keep the layout responsive.

Extend the existing single-page dashboard with an obvious Employer / Employee view switch and focused forms or dialogs for funding and withdrawal. Avoid adding a backend, authentication, wallet connection, smart contracts, external protocol integrations, or new dependencies.

## Acceptance checks

- A new browser session starts with a coherent, usable demo state.
- The stream counter advances while active and freezes when paused; resuming continues accrual.
- Savings rate changes update the spendable and saved breakdown consistently.
- A valid withdrawal updates all relevant balances and history once; invalid or excessive withdrawals do not change state.
- Employer funding changes the amount available for future accrual and the escrow balance; the displayed stream/funding status reflects both.
- Switching views and refreshing retain the same demo state.
- The interface works on narrow and desktop screens and does not represent simulated actions as real chain activity.

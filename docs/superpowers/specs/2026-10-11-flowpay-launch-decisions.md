# FlowPay Launch Decisions

This is the decision register for the small-business payroll system described in [the product design](./2026-10-11-flowpay-small-business-payroll-design.md). The owner of unresolved product choices is the FlowPay product owner. Do not fill these gaps with implementation defaults.

| Decision | Current status | Owner | Blocks |
| --- | --- | --- | --- |
| First launch jurisdiction and legal operating model | India and employer-funded direct payouts selected; FlowPay legal role, provider contracts, and supported compliance scope require qualified counsel review | Product owner, with qualified Indian counsel | Production payroll, tax, privacy, payout, and yield designs |
| Compensation asset and claim rail | INR payroll ledger with bank/electronic claims selected; MON remains Testnet demo until counsel validates token wage payments | Product owner; payout-provider/compliance specifics remain open | Production payout interfaces, payroll previews, and accounting |
| Sign-in identity and recovery | Wallet-only sign-in and user-controlled guardian/quorum recovery selected; supported wallet types and org governance details remain open | Product owner | Organization model, membership, wallet support, and recovery UX |
| Payroll roles, approval thresholds, and executor model | Maker-checker separation selected by default for payroll runs and sensitive employee/pay changes; thresholds, roles, and payout executor remain unresolved | Product owner | Authorization model, approval workflows, and payout execution |
| Employee claim policy and execution | Employee-initiated partial claims selected; auto-pay within approved limits selected with exceptions escalated; limits, fees, and settlement timing remain unresolved | Product owner | Claim authorization, payout workflow, payroll reconciliation, and liquidity design |
| Employee-yield strategy, custody, fees, exit timing, and loss allocation | Unresolved | Product owner after due diligence and independent security review | Employee yield implementation and any funds-moving plan |
| Application/indexer hosting, availability target, retention, and support model | Unresolved | Product owner and engineering owner | Production backend and operating procedures |

## Existing prototype facts

- The checked Monad Testnet chain reports chain ID `10143`.
- The configured local demo contract is `0xC8AAc9B5AE25834AA9e7198C8e8253776f61b6Ba`, deployed at block `69808500` by `0xcff5ee2a21dedee8f2eae71a403b5d2beced474c`; it has code at that block, no code at the previous block, and currently reports `streamCreated == true`.
- The README address and the old checked-in deployment artifact described different contracts and are not the configured active stream.
- This verifies the local Testnet prototype only. It does not establish a production deployment, a legal payroll model, or a yield strategy.

## Gate

Phase 1 implementation planning may begin when the product owner has resolved the choices that determine its interfaces: launch jurisdiction/legal model, compensation asset, organization identity/recovery, payroll approval/executor model, and employee claim policy. Employee-yield implementation remains separately gated on strategy diligence and independent review. Employer-reserve yield remains deferred until enforceable payroll liquidity and loss controls are proven.

## India launch research notes (11 October 2026)

These are product-design inputs, not a legal opinion. Qualified Indian counsel must confirm how they apply to FlowPay's actual employment, custody, payment, and yield model.

- The Code on Wages, 2019, section 15 lists current coin/currency notes, cheque, credit to an employee bank account, or electronic mode as wage-payment modes. This does not establish that a crypto-token payout qualifies as compliant wage payment. Until counsel confirms otherwise, keep statutory payroll amounts and payslips denominated in INR and do not treat an on-chain token transfer as satisfying an employer's wage-payment obligation. [India Code: Code on Wages, 2019](https://www.indiacode.nic.in/bitstream/123456789/15793/1/aA2019-29.pdf)
- The Ministry of Labour & Employment reported the four Labour Codes effective from 21 November 2025. Payroll rules and state/central implementation details need counsel and compliance review for the target employers. [Press Information Bureau notice](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2192463&lang=2&reg=3)
- The Income Tax Department's current TDS guidance says salary TDS for payments from 1 April 2026 is under section 392(1) of the Income Tax Act, 2025, with salary-payment date determining the transition. Payroll calculations, deductions, employer deposits, and reporting need a maintained ruleset rather than hard-coded assumptions. [Income Tax Department: TDS Compliance](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance)
- MeitY has notified the Digital Personal Data Protection Rules, 2025 with phased commencement. FlowPay will process employee identity, compensation, wallet, and payment records, so retention, notice/consent, access, deletion, and incident workflows need a counsel-reviewed privacy design. [MeitY: DPDP Rules, 2025](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025)
- RBI's payment-aggregator directions include escrow requirements for covered entities handling funds collected for merchants. Whether FlowPay's actual payout orchestration or money flow falls within any regulated category depends on the implementation and requires qualified Indian counsel; do not assume that using a vendor alone resolves FlowPay's role. [RBI: Regulation of Payment Aggregators and Payment Gateways](https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=11996)

## Selected v1 pay model

- Keep statutory payroll amounts, earning accrual, deductions, and payslip exports denominated in INR.
- Calculate earned pay continuously, while settling claims through a bank/electronic payout provider selected after vendor, compliance, and operational review. This provides the per-second balance experience without requiring an on-chain transaction every second.
- Keep MON payments as a Testnet/demo rail. Production token wage payment requires qualified Indian counsel to confirm whether and how a token transfer can satisfy wage-payment obligations and what tax/reporting treatment applies. Section 15 lists wage-payment modes but does not itself resolve whether a token transfer qualifies as an electronic mode.
- Employee yield on unclaimed INR salary is not part of v1. It remains a separate, gated product requiring legal, custody, liquidity, and accounting design; the long-term yield vision does not imply INR liabilities may be invested.

## Selected sign-in and recovery direction

- Product owner selected wallet-only sign-in and recovery. Do not add email/password identity as a parallel authentication path without revisiting this decision.
- Keep legal employee/business records, payroll data, and bank payout instructions as private application records linked to wallet-controlled access; a public address is not itself proof of legal identity or ownership of a payroll record.
- The wallet may authorize a payroll claim or profile change, but FlowPay must not hold user seed phrases or private keys.
- Use user-controlled guardian/quorum recovery for supported wallets, with FlowPay holding no keys. This is recovery of a wallet's authority, not a payroll approval and not permission for employer or FlowPay staff to seize an employee account.
- Define the supported wallet/recovery combinations before production onboarding. For a wallet without its configured recovery method, seed/backup restoration is its remaining recovery route unless the product owner approves a separate, independently verified wallet-rebinding design. Do not make employer administrators the default recovery guardians for employee wallets.
- Business workspace governance is still open: decide how multiple organization wallets are added/removed and how payroll approvals differ from wallet recovery guardians.

## Selected payroll approval direction

- Use maker-checker separation by default: one authorized wallet prepares a payroll run and a different authorized wallet approves it before payout.
- Sensitive employee or compensation changes also require approval by a different authorized wallet. Keep proposal, approval, and execution identities in the audit history.
- Still define organization roles, payout executor, approval limits and thresholds, exception handling, and the policy for very small businesses with only one available operator. Do not let a recovery guardian implicitly count as a payroll approver.

## Selected employee claim direction

- Employees can initiate partial claims against accrued, available INR earnings while a pay period is active, subject to employer policy and Indian payroll/legal validation.
- Each claim must reserve/offset the corresponding available amount exactly once; normal payroll must reconcile claims so the same earned amount cannot be paid again. Failed, pending, returned, and reversed bank payouts need explicit states and recovery behavior.
- Eligible requests within an employer-approved policy may execute automatically; out-of-policy exceptions must be routed for approval. Define claim limits, fees, payout timing, and how claims appear in payslips and payroll records.

## Selected funds-flow direction (counsel validation required)

- Product owner selected the employer-funded direct payout model: the employer remains employer and owner of payroll funds; FlowPay provides payroll workflow, accrual display, claim orchestration, and reconciliation; a reviewed bank/payment provider initiates employer-to-employee payouts directly from the employer's account. FlowPay does not receive, pool, or custody payroll funds.
- This is a product choice for counsel to assess, not a conclusion that FlowPay avoids RBI authorization or other obligations. The specific contracts, data roles, payment instructions, and fund flows determine the legal analysis. Provider selection and legal validation remain release gates.
- Alternative: FlowPay or a FlowPay-controlled account receives and pools employer funds before disbursement. This could change safeguarding, escrow, authorization, and operations requirements and should be chosen only after counsel and provider diligence.

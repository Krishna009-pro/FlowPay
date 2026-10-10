# FlowPay multi-stream design

## Goal

Let one employer manage salary streams for multiple employees from the FlowPay dashboard. A stream remains a separate contract, so the existing salary accounting and claim rules continue to apply independently to each employee.

The implementation targets Monad Testnet. It does not deploy anything to Monad Mainnet, add yield, or require a backend.

## Current constraints

- `FlowPay` stores one employee and rejects a second `createStream` call.
- The frontend reads and writes one contract address from `VITE_FLOWPAY_CONTRACT_ADDRESS`.
- The current deployed contract is immutable and cannot be upgraded in place.
- The current deployed contract remains available as a legacy stream after the new factory is deployed.

## Chosen approach

Add a `FlowPayFactory` registry that creates a new stream contract for each employee and records each stream under both its employer and employee. The employer creates and funds a stream in one wallet transaction. The new child contract is initialized with the employer, employee, salary rate, and initial native MON amount; afterward, the existing claim, savings, pause, resume, and top-up calls operate directly on that child contract.

Keep the existing no-argument `FlowPay` deployment path and ABI for current deployments. Factor shared stream accounting into a reusable base and add an initialized child type for factory-created streams. This avoids changing the constructor or address of the contract already deployed on Testnet.

The factory will expose account-scoped stream lists and emit an event containing the employer, employee, and new stream address. It will not custody funds: the factory forwards the initial deposit into the child as it is created. It will also support registering an existing FlowPay stream after checking that the caller is its employer and that the stream has been created. This lets the current contract appear in the same employer list without moving its funds.

## Frontend behavior

- Add an employer stream list and a clear **New stream** action, available even when another stream already exists.
- The create form asks for employee wallet address, monthly salary, and initial funding. It submits one payable factory transaction and selects the new stream after confirmation.
- When a wallet connects, load streams for that wallet from the factory as employer and as employee. Include the configured legacy stream only when the connected wallet is its employer or employee. With no wallet connected, keep the configured legacy stream available for read-only viewing.
- Selecting a stream switches the dashboard snapshot, claim balances, payroll controls, transaction actions, and activity to that contract address.
- Employees see only streams indexed to their connected wallet; employers see streams they created or registered.
- Importing the existing stream is an employer-only factory action and does not move funds or alter the existing contract.
- If the factory is not configured, keep the current legacy stream usable and explain that creating additional streams needs the new factory deployment. Do not present simulated streams.

## Configuration and deployment

Keep the current legacy settings:

- `VITE_FLOWPAY_CONTRACT_ADDRESS`
- `VITE_FLOWPAY_DEPLOYMENT_BLOCK`

Add:

- `VITE_FLOWPAY_FACTORY_ADDRESS`
- `VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK`

The frontend build and configuration docs will explain that the factory must first be compiled and deployed to Monad Testnet. Its public address and deployment block are then added to hosting environment variables and the site is rebuilt. No private key is included in the frontend or hosting variables.

## Error handling and safety

- Factory creation reverts atomically if the employee, rate, or initial funding is invalid; no half-created stream is indexed.
- Registering an existing contract checks code presence, employer ownership, and `streamCreated`; duplicate registration is rejected.
- Stream reads and transactions always use the selected stream address. A failed stream read should not silently write to another employee's contract.
- The current single-stream deployment and its existing history remain accessible through the legacy address and deployment block.
- New and imported streams are identified as Testnet contracts in the UI and explorer links.

## Out of scope

- Multiple currencies, yield generation, automated payroll, employee names or HR records, mainnet deployment, and backend services.
- Upgrading or migrating the current stream's funds.

## Acceptance criteria

1. An employer can create two separate streams for two different employee addresses through the UI, each in its own confirmed Monad Testnet transaction.
2. The employer can select either stream and independently read its balances and pause, resume, and top up it.
3. Each employee wallet can discover its own stream, see accrued salary/savings, and claim only from that stream.
4. The existing configured legacy FlowPay contract remains viewable and its existing employer/employee actions continue to target its original address.
5. The UI displays actual factory and child contract data only; no local fake stream records are added.

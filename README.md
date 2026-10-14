# FlowPay

FlowPay is a per-second salary-streaming product on Monad, with a separate India payroll workspace under development. The Monad Testnet app lets employers fund individual MON streams and employees claim vested pay directly on-chain.

The Monad experience currently targets Testnet; it is not production payroll and does not pay INR wages. The separate payroll workspace uses synthetic local records and services only. Hosting the website does not deploy a contract or move it to mainnet.

## Project info

| | |
| --- | --- |
| **Project name** | FlowPay |
| **Description** | Salary streams on Monad, with real-time earnings and an optional savings reserve. |
| **Live demo** | [flowpay-lake.vercel.app](https://flowpay-lake.vercel.app/) |
| **Project post** | [View FlowPay on X](https://x.com/VaishnaviBubnx/status/2108897030353637518) |
| **Configured local demo contract** | [`0xC8AAc9B5AE25834AA9e7198C8e8253776f61b6Ba`](https://testnet.monadscan.com/address/0xC8AAc9B5AE25834AA9e7198C8e8253776f61b6Ba) |
| **Network** | Monad Testnet · Chain ID `10143` |
| **Deployment block** | `69808500` |
| **Event** | Monad Blitz Pune V3 |

## Existing Testnet demonstration

- Each employee salary stream is a separate FlowPay contract.
- Employers can fund streams, top them up, pause them, and resume them.
- Employees can see per-second vesting and claim vested salary or their reserved savings.
- The dashboard discovers streams indexed to the connected employer or employee wallet.
- An employer can import the original single-stream contract into the registry without moving its funds.
- Transaction links open on MonadScan.

The savings reserve is held in its stream contract and does **not** earn yield. Transactions are signed in the user's wallet; FlowPay does not need a server-side wallet key. The original single-stream contract remains available as a legacy deployment.

## Run locally

Requirements: Node.js and a wallet such as MetaMask.

```bash
git clone https://github.com/Krishna009-pro/FlowPay.git
cd FlowPay
npm install
```

Copy `.env.example` to `.env.local`, then run:

```bash
npm run dev
```

Open `http://localhost:5173`. Use MetaMask on Monad Testnet (chain ID `10143`) and test MON from the [Monad faucet](https://faucet.monad.xyz).

Run the local regression suites with `npm test`. They test wallet/network helpers and the Solidity contract against a local Foundry EVM; they do not send transactions to Monad Testnet.

## Multi-employee Monad Testnet setup

The existing FlowPay contract cannot be upgraded in place. To create additional streams, compile and deploy the new registry factory once. This does not migrate the existing stream or move its funds.

1. Compile the contracts and set a **dedicated Testnet-only** deployer key in the current PowerShell process. Do not use a wallet that holds valuable assets:

   ```powershell
   node contracts/compile.js
   $env:PRIVATE_KEY = '0x<testnet-only-private-key>'
   node contracts/deployFactory.js
   Remove-Item Env:PRIVATE_KEY
   ```

2. After checking the confirmed address and block on MonadScan, add them to `.env.local`:

   ```dotenv
   VITE_FLOWPAY_FACTORY_ADDRESS=0x<verified-factory-address>
   VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK=<confirmed-deployment-block>
   ```

3. Restart `npm run dev`, connect an employer wallet on Monad Testnet, and use **Employer payroll → New employee stream**. The employer signs one transaction that deploys and funds that employee's stream. Employees connect their wallet to discover and claim from their own indexed streams.

The factory forwards initial funding directly to the new stream and never holds payroll funds. The legacy contract remains usable when factory configuration is missing. Testnet MON is for demonstration only. No deployment transaction is run by the local build or compile command.

## Local payroll system workspace

The payroll workspace is a separate local service from the Monad Testnet demo. In the browser, choose **Payroll system** for wallet sign-in, organization setup, wallet invitations and role management, employee create/approve, payroll-period management, and employee claim history. Organization owners invite additional wallets by role; the invited wallet must sign in and accept using its own session. Invitations expire after seven days.

The backend also has private INR compensation terms, payroll run snapshots and maker-checker gates, claim-policy approval, employee claim reservations, an append-only paise ledger, an idempotent outbox, and a fake-only payout worker with reconciliation-safe states. The local workspace can create a generated fake recipient reference and append an estimated synthetic accrual from approved compensation terms to demonstrate claims; those endpoints are absent in production mode. The fake adapter is memory-only with no network access. These pieces are a local simulation, not an available bank payout or production payroll service.

1. Start a local-only PostgreSQL 18 container. In PowerShell, set a disposable password for this local database and start the service:

   ```powershell
   $env:POSTGRES_PASSWORD = 'local-only-change-me'
   docker compose up -d postgres
   ```

2. In the same shell, set the database URL and start the API:

   ```powershell
   $env:DATABASE_URL = 'postgres://flowpay:local-only-change-me@127.0.0.1:5433/flowpay'
   npm run dev:api
   ```

   `GET http://127.0.0.1:3001/health` reports API liveness. `GET http://127.0.0.1:3001/ready` also checks PostgreSQL readiness. The default bind address is loopback-only.

3. Configure `APP_ORIGINS` to the exact browser origins that may sign in (the local default is `http://localhost:5173`). The Vite development server proxies `/api` to the local API. Run backend tests with `npm run test:api`. Run checked-in database migrations with `npm run db:migrate` after PostgreSQL is available.

Wallet authentication currently supports EOA `personal_sign` style signatures; contract-wallet verification and guardian recovery remain unsupported until the production wallet/recovery matrix is selected. Sign-in uses one-time, origin-bound messages and short-lived hashed server sessions in HttpOnly, SameSite cookies (Secure in production). FlowPay never receives a seed phrase or private key.

The database volume is named `flowpay-postgres-data` and survives container restarts. It is local development data and should contain synthetic records only. Never configure a real bank provider, production credentials, employee PII, or real payroll funds in this development service.

## Payroll maturity and release gates

The INR workspace currently stops short of production payroll execution. Payroll approval fails closed until an approved India rules provider is configured. The only accrual writer is a local estimated simulation, not a production salary accrual service or validated statutory calculation. There is no bank provider, guardian recovery flow, or production wallet verification matrix. The organization claim queue and local fake payout dispatch/reconciliation controls are available for synthetic workflows. Do not enter real employee or bank information.

The Monad Testnet screen remains a separate MON demonstration. It does not pay INR wages, fund the INR ledger, or connect to an Indian payment rail. A production launch still needs Indian legal and payroll review, provider and employer authorization validation, data-protection/retention decisions, supported wallet/recovery governance, and operational controls.

## Host on Vercel

1. Import this GitHub repository into Vercel. Set the project root to the repository root.
2. Use the Vite defaults: build command `npm run build`, output directory `dist`, and install command `npm install`.
3. Add these environment variables in Vercel Project Settings for Production and Preview:

   | Variable | Value for the current Monad Testnet deployment |
   | --- | --- |
   | `VITE_MONAD_RPC_URL` | `https://testnet-rpc.monad.xyz` |
   | `VITE_MONAD_CHAIN_ID` | `10143` |
   | `VITE_FLOWPAY_CONTRACT_ADDRESS` | `0xC8AAc9B5AE25834AA9e7198C8e8253776f61b6Ba` |
   | `VITE_FLOWPAY_DEPLOYMENT_BLOCK` | `69808500` |
   | `VITE_FLOWPAY_FACTORY_ADDRESS` | Set after deploying and verifying the Testnet factory; leave blank to use only the legacy stream. |
   | `VITE_FLOWPAY_FACTORY_DEPLOYMENT_BLOCK` | Set to the factory's confirmed Testnet deployment block. |

4. Deploy, then open the provided URL and connect a Monad Testnet wallet.

`vercel.json` includes the rewrite needed for direct links to this single-page React app. Redeploy after changing environment variables because Vite embeds `VITE_` values in the browser bundle.

**Do not put a private key or seed phrase in Vercel settings, source files, or any `VITE_` variable.** `VITE_` values are public client-side configuration. The app asks MetaMask to sign transactions in the browser.

## Network and contract

- Network: Monad Testnet
- Chain ID: `10143`
- Native token: `MON`
- RPC: `https://testnet-rpc.monad.xyz`
- Explorer: [MonadScan Testnet](https://testnet.monadscan.com)
- Locally configured demo contract: [0xC8AAc9B5AE25834AA9e7198C8e8253776f61b6Ba](https://testnet.monadscan.com/address/0xC8AAc9B5AE25834AA9e7198C8e8253776f61b6Ba)
- Deployment block: `69808500`

The contract address and deployment block are public chain data. The repository contains older deployment records; the local demo values above were checked against Monad Testnet and report a created stream. If the contract is redeployed, verify the address, employer, and stream state before updating `.env.local` or hosting settings, then rebuild/redeploy the website.

## Deploy a prototype contract

Compile with `node contracts/compile.js`, then set `PRIVATE_KEY` only in the current process using your secure key-management workflow and run `node contracts/deploy.js`. The script reports the deployed address and block but does not write frontend configuration files. Verify the deployment on MonadScan, then update the public `VITE_FLOWPAY_CONTRACT_ADDRESS` and `VITE_FLOWPAY_DEPLOYMENT_BLOCK` values yourself. Never pass the key as a command-line argument or commit it.

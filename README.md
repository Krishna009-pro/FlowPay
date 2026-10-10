# FlowPay

FlowPay lets employers send salary as a steady stream of native MON on Monad Testnet. Employees can see their pay build up by the second, claim what they have earned, and set aside a share for savings.

This is a hackathon project currently connected to a **Monad Testnet** contract. Hosting the website does not deploy a contract or move it to mainnet.

## Project info

| | |
| --- | --- |
| **Project name** | FlowPay |
| **Description** | Salary streams on Monad, with real-time earnings and an optional savings reserve. |
| **Live demo** | [flowpay-lake.vercel.app](https://flowpay-lake.vercel.app/) |
| **Project post** | [View FlowPay on X](https://x.com/VaishnaviBubnx/status/2108897030353637518) |
| **Contract** | [`0xe0bB03BdE17a457C8e9e07581B05056eEe321931`](https://testnet.monadscan.com/address/0xe0bB03BdE17a457C8e9e07581B05056eEe321931) |
| **Network** | Monad Testnet · Chain ID `10143` |
| **Deployment block** | `69796334` |
| **Event** | Monad Blitz Pune V3 |

## What works

- Employer creates and funds a salary stream from a connected wallet.
- Employee sees the current on-chain stream state and can claim vested salary or savings.
- Employer can add funding, pause a stream, and resume a paused stream.
- Transaction links open on MonadScan.

Transactions are signed in the user's wallet. FlowPay does not need a server-side wallet key.

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

## Host on Vercel

1. Import this GitHub repository into Vercel. Set the project root to the repository root.
2. Use the Vite defaults: build command `npm run build`, output directory `dist`, and install command `npm install`.
3. Add these environment variables in Vercel Project Settings for Production and Preview:

   | Variable | Value for the current Monad Testnet deployment |
   | --- | --- |
   | `VITE_MONAD_RPC_URL` | `https://testnet-rpc.monad.xyz` |
   | `VITE_MONAD_CHAIN_ID` | `10143` |
   | `VITE_FLOWPAY_CONTRACT_ADDRESS` | `0xe0bB03BdE17a457C8e9e07581B05056eEe321931` |
   | `VITE_FLOWPAY_DEPLOYMENT_BLOCK` | `69796334` |

4. Deploy, then open the provided URL and connect a Monad Testnet wallet.

`vercel.json` includes the rewrite needed for direct links to this single-page React app. Redeploy after changing environment variables because Vite embeds `VITE_` values in the browser bundle.

**Do not put a private key or seed phrase in Vercel settings, source files, or any `VITE_` variable.** `VITE_` values are public client-side configuration. The app asks MetaMask to sign transactions in the browser.

## Network and contract

- Network: Monad Testnet
- Chain ID: `10143`
- Native token: `MON`
- RPC: `https://testnet-rpc.monad.xyz`
- Explorer: [MonadScan Testnet](https://testnet.monadscan.com)
- Current contract: [0xe0bB03BdE17a457C8e9e07581B05056eEe321931](https://testnet.monadscan.com/address/0xe0bB03BdE17a457C8e9e07581B05056eEe321931)
- Deployment block: `69796334`

The contract address and deployment block are public chain data. If the contract is redeployed, update both values in `.env.local` or the hosting provider's environment settings, then rebuild/redeploy the website.

# CTC-Perps

Decentralized perpetual futures platform for commodity trading. Supports Gold (XAU), Silver (XAG), Crude Oil (CL1), and Platinum (XPT) with real-time price feeds from Autonom Oracle.

## Quick Start

```bash
./start.sh
```

That's it. `start.sh` is fully self-contained — it kills stale processes, cleans artifacts, wipes the database, deploys contracts, and boots all services. After ~20 seconds you'll have:

| Service       | URL                          |
|---------------|------------------------------|
| Frontend      | http://localhost:3000         |
| Oracle API    | http://localhost:3001         |
| Oracle WS     | ws://localhost:8080           |
| Anvil RPC     | http://127.0.0.1:8545        |

Default accounts (Anvil):
- **Deployer**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (key: `0xac09...ff80`)
- **Oracle Signer**: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (key: `0x59c6...79C8`)

Press `Ctrl+C` to stop all services.

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Frontend    │◄────│ Oracle WS/API│────►│   Autonom    │
│  (Next.js)   │     │  (Node/tsx)  │     │  (external)  │
└──────┬───────┘     └──────┬───────┘     └──────────────┘
       │                    │
       │     ┌──────────────┘
       ▼     ▼
┌──────────────────────────────────────┐
│            Anvil (EVM)               │
│  Oracle, Trading, P2PTrading, Pool,  │
│  VAMM, Custody, FeeManager,         │
│  MarketState, Governance             │
└──────────────────────────────────────┘
```

---

## Prerequisites

- **Foundry** — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Node.js** >= 18 — for oracle and frontend
- **PostgreSQL** (optional) — oracle falls back to in-memory if unavailable

---

## Project Structure

```
ctc-perps/
├── contracts/                 # Solidity smart contracts (Foundry)
│   ├── src/
│   │   ├── core/              # Oracle, Trading, P2PTrading, Pool, VAMM, Custody, FeeManager, MarketState
│   │   ├── tokens/            # MockUSDC, CLP (LP token), CPERP (governance token)
│   │   ├── governance/        # Governance (DAO proposals)
│   │   └── libraries/         # FeeCalculator, FixedPointMath, PositionUtils, PriceUtils, WaterfallWithdraw
│   ├── test/
│   │   ├── helpers/           # TestSetup.sol (shared test base)
│   │   └── unit/              # Unit tests
│   └── script/
│       └── DeployLocal.s.sol  # Anvil deployment script
├── oracle/                    # Off-chain oracle service
│   ├── src/
│   │   ├── config/            # Feed IDs, contract addresses, thresholds
│   │   ├── services/          # fetcher, chainPusher, priceStore, database, marketStateDetector, websocketServer
│   │   ├── keepers/           # feeAccrualKeeper, liquidationEngine, p2pSettlementKeeper, positionTracker
│   │   └── utils/             # logger, retry, signing
│   └── prisma/                # DB schema (optional PostgreSQL)
├── frontend/                  # Next.js trading UI
│   └── src/
│       ├── lib/               # contracts.ts (addresses, ABIs, feed config)
│       └── components/        # Trading UI components
├── start.sh                   # One-command full stack startup
└── .addresses.json            # Deployed contract addresses (generated)
```

---

## Individual Process Startup

If you need to run services individually (e.g., for debugging), here's how each one works.

### 1. Anvil (Local EVM)

```bash
~/.foundry/bin/anvil --port 8545 --block-time 2 --silent
```

- Runs a local Ethereum node on port **8545**
- `--block-time 2` mines a block every 2 seconds
- `--silent` suppresses per-block logging
- Ships with 10 pre-funded accounts (each with 10,000 ETH)

Verify it's running:
```bash
curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### 2. Contract Deployment (Forge)

**Requires**: Anvil running on port 8545.

```bash
cd contracts

DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
ORACLE_SIGNER="0x70997970C51812dc3A010C7d01b50e0d17dc79C8" \
~/.foundry/bin/forge script script/DeployLocal.s.sol:DeployLocal \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
```

Deployment does the following in order:
1. Deploys tokens: MockUSDC, CLP (proxy), CPERP
2. Deploys Oracle (proxy) with feeds [2056, 2069, 2003, 2062] and staleness threshold **210 seconds**
3. Deploys Pool (proxy), transfers CLP ownership to Pool
4. Deploys FeeManager (proxy)
5. Deploys MarketState (proxy), registers all 4 feeds
6. Deploys 4 Custody contracts (one per feed)
7. Deploys Trading (proxy) with minPositionOpenTime **400 seconds**
8. Deploys VAMM (proxy) with depth multipliers per feed
9. Deploys P2PTrading (proxy)
10. Deploys Governance (proxy)
11. Mints 10M test USDC to deployer
12. Transfers all contract ownership to Governance

**Key init parameters**:
- Oracle staleness: `210` seconds (accommodates Autonom's ~120s commodity feed cadence)
- Trading minPositionOpenTime: `400` seconds (positions must be open 400s before closing)
- FeeManager: 0.1% open/close fee, 5% max base rate/hr, 0.01% max funding, 90% to LPs

**Supported feeds**:

| Feed ID | Asset      | Symbol | VAMM Depth     |
|---------|------------|--------|----------------|
| 2056    | Gold       | XAU    | $13,000,000    |
| 2069    | Silver     | XAG    | $5,000,000     |
| 2003    | Crude Oil  | CL1    | $2,000,000     |
| 2062    | Platinum   | XPT    | $3,000,000     |

To clean and redeploy from scratch:
```bash
rm -rf contracts/broadcast/
# Then re-run the forge script command above
```

### 3. Oracle Service

**Requires**: Anvil running, contracts deployed. Parse addresses from forge output or `.addresses.json`.

```bash
cd oracle

ORACLE_ADDRESS="0x..." \
TRADING_ADDRESS="0x..." \
P2P_TRADING_ADDRESS="0x..." \
MARKET_STATE_ADDRESS="0x..." \
VAMM_ADDRESS="0x..." \
POOL_ADDRESS="0x..." \
FEE_MANAGER_ADDRESS="0x..." \
CUSTODY_ADDRESSES='{"2056":"0x...","2069":"0x...","2003":"0x...","2062":"0x..."}' \
SIGNER_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" \
RPC_URL="http://127.0.0.1:8545" \
DATABASE_URL="postgresql://localhost:5432/ctc_perps" \
CHAIN_ID=31337 \
WS_PORT=8080 \
API_PORT=3001 \
npx tsx src/index.ts
```

**What the oracle does**:
- **Fetcher**: Polls Autonom every 500ms for price data on all 4 feeds
- **ChainPusher**: Signs and submits prices to the on-chain Oracle contract
- **PriceStore**: Stores price ticks and builds candle data (in-memory or PostgreSQL)
- **WebSocket Server** (port 8080): Broadcasts real-time price ticks and market state changes to frontend
- **REST API** (port 3001):
  - `GET /api/candles/:feedId/:interval?limit=100` — candle data
  - `GET /api/price/:feedId` — latest price
  - `GET /api/health` — health check
- **Keepers** (automated on-chain actions):
  - Fee accrual: calls `accrueBaseFee()` periodically
  - Liquidation engine: monitors positions and liquidates when below maintenance margin
  - P2P settlement: settles P2P trades when markets open
  - Position tracker: replays and watches `PositionOpened`/`PositionClosed` events

**Config** (`oracle/src/config/index.ts`):
- `stalenessThresholdMs`: 210,000ms — oracle skips pushing if price hasn't changed within this window
- `fetchIntervalMs`: 500ms — polling interval for Autonom
- `feeInterval`: 15 — ticks between fee accrual calls

**Database**: PostgreSQL is optional. If `DATABASE_URL` is set and Postgres is reachable, price ticks and candles are persisted. Otherwise falls back to in-memory storage with no data loss for the current session.

To install dependencies (first time):
```bash
cd oracle && npm install
```

### 4. Frontend

**Requires**: Oracle service running (WS + API).

```bash
cd frontend

NEXT_PUBLIC_TRADING_ADDRESS="0x..." \
NEXT_PUBLIC_P2P_TRADING_ADDRESS="0x..." \
NEXT_PUBLIC_POOL_ADDRESS="0x..." \
NEXT_PUBLIC_MOCK_USDC_ADDRESS="0x..." \
NEXT_PUBLIC_MARKET_STATE_ADDRESS="0x..." \
NEXT_PUBLIC_ORACLE_ADDRESS="0x..." \
NEXT_PUBLIC_VAMM_ADDRESS="0x..." \
NEXT_PUBLIC_GOVERNANCE_ADDRESS="0x..." \
NEXT_PUBLIC_CLP_ADDRESS="0x..." \
NEXT_PUBLIC_CPERP_ADDRESS="0x..." \
NEXT_PUBLIC_WS_URL="ws://localhost:8080" \
NEXT_PUBLIC_API_URL="http://localhost:3001" \
NEXT_PUBLIC_RPC_URL="http://127.0.0.1:8545" \
NEXT_PUBLIC_CHAIN_ID=31337 \
npx next dev --port 3000
```

- **Port**: 3000
- **Stack**: Next.js 16 + React 19 + RainbowKit + wagmi + TanStack Query + TailwindCSS + lightweight-charts
- All contract addresses are passed via `NEXT_PUBLIC_*` env vars
- Feed config is in `frontend/src/lib/contracts.ts`
- Position feed names are in `frontend/src/components/trading/PositionList.tsx`

To install dependencies (first time):
```bash
cd frontend && npm install
```

---

## Running Tests

### Solidity (Foundry)

```bash
cd contracts
~/.foundry/bin/forge test
```

Tests cover: Oracle price updates, Pool/Custody logic, fee calculation, fixed-point math, price utils, token minting, governance proposals.

Test setup uses the same feed IDs and staleness threshold as production (`contracts/test/helpers/TestSetup.sol`).

### Oracle (Vitest)

```bash
cd oracle
npx vitest run
```

Tests cover: price fetcher, price store/candles, market state detection, fee accrual keeper, liquidation engine, position tracker.

---

## Database (Optional)

If you want persistent candle/price data across restarts:

```bash
# Install PostgreSQL (macOS)
brew install postgresql@17
brew services start postgresql@17

# Create database
createdb ctc_perps

# Push schema
cd oracle
DATABASE_URL="postgresql://localhost:5432/ctc_perps" npx prisma db push
```

To wipe and recreate:
```bash
dropdb ctc_perps && createdb ctc_perps
cd oracle && DATABASE_URL="postgresql://localhost:5432/ctc_perps" npx prisma db push
```

The `start.sh` script handles this automatically if `psql` is available.

---

## Key Configuration Reference

| Parameter              | Value  | Location                          | Notes                                       |
|------------------------|--------|-----------------------------------|---------------------------------------------|
| Oracle staleness       | 210s   | DeployLocal.s.sol line 62         | On-chain; must redeploy to change           |
| Min position open time | 400s   | DeployLocal.s.sol line 118        | On-chain; must redeploy to change           |
| Oracle staleness (off-chain) | 210,000ms | oracle/src/config/index.ts | Oracle service skip threshold          |
| Fetch interval         | 500ms  | oracle/src/config/index.ts        | Autonom polling rate                        |
| Fee accrual interval   | 15     | oracle/src/config/index.ts        | Ticks between fee accrual calls             |
| Anvil block time       | 2s     | start.sh                          | Local chain block production rate           |

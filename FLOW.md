# CTC-Perps: System Architecture & Service Flow

## High-Level Overview

CTC-Perps is a 4-service system: an **external price oracle**, a **TypeScript oracle service**, a **Solidity smart contract layer**, and a **Next.js frontend**. Every arrow below represents a real data or transaction flow.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER (MetaMask)                                │
│   Trade / LP Deposit / Govern                                           │
└──────────────┬──────────────────────────────────┬───────────────────────┘
               │ wagmi/viem txns                  │ WebSocket + REST
               ▼                                  ▼
┌──────────────────────────┐      ┌──────────────────────────────────────┐
│     FRONTEND (Next.js)   │◄────►│     ORACLE SERVICE (TypeScript)      │
│   localhost:3000         │      │   Fetcher / Keepers / WS / API       │
└──────────────┬───────────┘      └──────────┬───────────────────────────┘
               │                             │ Signed txns (ECDSA)
               │ Read/Write contracts        │ via Anvil RPC
               ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    SMART CONTRACTS (Anvil EVM)                           │
│                    http://127.0.0.1:8545                                 │
│                                                                         │
│  Oracle ← MarketState ← Trading/P2PTrading → Custody → Pool            │
│                            ↕           ↕                                │
│                         FeeManager    VAMM                              │
│                                                                         │
│  Tokens: MockUSDC, CLP, CPERP    Governance → all admin functions       │
└─────────────────────────────────────────────────────────────────────────┘
               ▲
               │ HTTP polling (0.5s)
┌──────────────┴───────────┐
│  AUTONOM ORACLE API      │
│  178.128.21.71:3000      │
│  Gold/Silver/Copper/Plat │
└──────────────────────────┘
```

---

## Detailed Service Flows

### 1. Price Flow (Autonom → Chain → Frontend)

```
Autonom API ──0.5s poll──► Fetcher ──► PriceStore ──► WebSocket Server ──► Frontend
                              │                              (ws://localhost:8080)
                              │
                              ├──► ChainPusher ──ECDSA sign──► Oracle.sol (updatePrices)
                              │
                              └──► MarketStateDetector ──► MarketState.sol (updateState)
                                          │
                                          └──► VAMM.sol (initializeVAMM / deactivateVAMM)
```

- **Fetcher** polls Autonom every 500ms for 4 feeds (Gold 2056, Silver 2069, Copper 2015, Platinum 2062)
- **ChainPusher** signs price batch with ECDSA private key, submits to Oracle.sol
- **MarketStateDetector** reads `fresh` flag: `true` = market open, `false` = market closed
- **PriceStore** aggregates ticks into OHLCV candles (15s, 1m, 5m, 15m, 1h)
- **WebSocket Server** broadcasts raw ticks to all connected frontends
- **REST API** (localhost:3001) serves historical candles for TradingView charts

### 2. Market-Hours Trading Flow

```
User ──► Frontend ──► Trading.sol
                          │
                          ├──► Oracle.sol (getPriceIfFresh)
                          ├──► MarketState.sol (isMarketOpen? must be YES)
                          ├──► FeeManager.sol (calculateOpenCloseFee)
                          ├──► Custody.sol (increasePosition / decreasePosition / payTrader)
                          └──► Pool.sol (receiveFees / absorbPnL)
```

**Open**: User deposits USDC → Custody holds it → Position recorded with fee snapshots
**Close**: Oracle price → PnL calc → Funding applied → Base fee + close fee deducted → Trader paid from Custody
**Liquidate**: Anyone calls → effective collateral check (PnL + fees + funding) → if < 30% margin → force close

### 3. Off-Hours P2P Trading Flow

```
User ──► Frontend ──► P2PTrading.sol
                          │
                          ├──► MarketState.sol (isMarketOpen? must be NO)
                          ├──► VAMM.sol (swap / reverseSwap — x*y=k price discovery)
                          ├──► FeeManager.sol (calculateOpenCloseFee)
                          └──► Pool.sol (receiveFees — open/close fee goes to LPs)
```

- VAMM provides synthetic price when real oracle is stale
- Collateral held in P2PTrading.sol escrow (separate from main pool)
- Profit capped at other traders' collateral (zero-sum)
- No liquidations during off-hours

### 4. Market Transition Flow

```
Market Close (fresh=false):
  MarketStateDetector ──► MarketState.sol (state → CLOSED)
  MarketStateDetector ──► VAMM.sol (initializeVAMM at last spot price)
  Main positions: stay open, keep accruing fees, no liquidation
  P2P positions: can now open/close via VAMM

Market Open (fresh=true):
  MarketStateDetector ──► MarketState.sol (state → OPEN)
  MarketOpenKeeper ──► P2PTrading.sol (settleP2PBatch at real spot price)
  KeeperCoordinator: settlement MUST complete before main trading resumes
  MainKeeper ──► Trading.sol (liquidate any positions underwater at new spot)
  MarketStateDetector ──► VAMM.sol (deactivateVAMM)
```

### 5. Keeper Flow

```
KeeperCoordinator
    │
    ├──► MainKeeper (every 0.5s during market hours)
    │        └──► Trading.sol.liquidate() for each undercollateralized position
    │
    └──► MarketOpenKeeper (triggered on fresh=true transition)
             └──► P2PTrading.sol.settleP2PBatch() at real oracle price
             └──► Retries until 100% settled
```

- **KeeperCoordinator** prevents overlap: MarketOpenKeeper runs first, MainKeeper waits
- Both use the same Anvil RPC signer (oracle service private key)

### 6. LP (Liquidity Provider) Flow

```
User ──► Frontend ──► Pool.sol
                        │
                        ├──► deposit(USDC) → mint CLP → distribute to Custodies (by allocation %)
                        ├──► withdraw(CLP) → burn CLP → waterfall withdraw from Custodies
                        │         └──► WaterfallWithdraw.sol (proportional, then redistribute shortfall)
                        │
                        ├──► receiveFees(amount) → totalPoolUSDC += amount
                        └──► absorbPnL(impact) → totalPoolUSDC += impact (can be negative)
```

- **CLP price** = totalPoolUSDC / CLP.totalSupply (increases as fees accrue, traders lose)
- **All USDC lives in Custodies** — Pool.sol is accounting only
- **4 Custodies**: Gold, Silver, Copper, Platinum — each with independent OI and fee accumulators

### 7. Fee & Funding Flow

```
                    ┌─── Base Fee (both sides pay) ───► Pool/LPs (90%) + Protocol (10%)
                    │
Custody.accrueFees()├─── Funding Rate (zero-sum) ───► Pool as intermediary
(every 15s)         │       Long pays → Pool gains    (net zero when balanced)
                    │       Short receives → Pool loses
                    │
                    └─── Open/Close Fee (0.1%) ───► Pool/LPs (90%) + Protocol (10%)
```

### 8. Governance Flow

```
CPERP holder ──► Governance.sol
                    │
                    ├──► propose(target, callData) — any admin function on any contract
                    ├──► vote(proposalId, support) — CPERP-weighted, 48hr window
                    └──► execute(proposalId) — requires 20% quorum + 51% majority
                              │
                              └──► target.call(callData) — changes any parameter:
                                   custody allocations, fee rates, VAMM depth,
                                   oracle signer, max leverage, pause/unpause, upgrades
```

### 9. Contract Dependency Graph

```
                    ┌──────────┐
                    │ Oracle   │◄──── ChainPusher (off-chain)
                    └────┬─────┘
                         │ getPriceIfFresh()
                    ┌────▼─────┐
                    │MarketState│◄──── MarketStateDetector (off-chain)
                    └──┬────┬──┘
                       │    │ isMarketOpen()
            ┌──────────▼┐  ┌▼───────────┐
            │  Trading   │  │ P2PTrading  │
            └──┬──┬──┬──┘  └──┬──┬──┬───┘
               │  │  │        │  │  │
    ┌──────────▼┐ │  │   ┌────▼┐ │  │
    │ FeeManager│ │  │   │VAMM │ │  │
    └───────────┘ │  │   └─────┘ │  │
                  │  │           │  │
            ┌─────▼──▼───────────▼──▼─┐
            │        Pool.sol          │ ◄──── Frontend (deposit/withdraw)
            │   (accounting only)      │
            └─────────┬────────────────┘
                      │ addLiquidity / removeLiquidity
          ┌───────────┼───────────┬───────────┐
          ▼           ▼           ▼           ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
     │Custody  │ │Custody  │ │Custody  │ │Custody  │
     │(Gold)   │ │(Silver) │ │(Copper) │ │(Platinum)│
     └─────────┘ └─────────┘ └─────────┘ └─────────┘
          │           │           │           │
          └───────────┴───────────┴───────────┘
                    All USDC lives here

     ┌───────────┐
     │Governance  │───► ANY admin function on ANY contract
     └───────────┘
```

---

## Port Map

| Service | Port | Protocol |
|---------|------|----------|
| Frontend | localhost:3000 | HTTP |
| Oracle REST API | localhost:3001 | HTTP |
| Oracle WebSocket | localhost:8080 | WS |
| Anvil RPC | 127.0.0.1:8545 | HTTP/JSON-RPC |
| PostgreSQL | localhost:5432 | TCP (optional) |

## Startup Order

```
1. Anvil (local EVM)           ← must be first
2. Deploy contracts            ← DeployLocal.s.sol → .addresses.json
3. Oracle Service              ← reads .addresses.json, connects to Autonom + Anvil
4. Frontend                    ← reads .addresses.json, connects to Oracle WS + Anvil RPC
```

All orchestrated by `./start.sh`.

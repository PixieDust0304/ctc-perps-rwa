# pErp-man: System Architecture & Service Flow

## High-Level Overview

pErp-man is a 5-service system: an **external price oracle**, a **TypeScript oracle service**, a **Solidity smart contract layer**, a **PostgreSQL database**, and a **Next.js frontend**. Every arrow below represents a real data or transaction flow.

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
└──────────────┬───────────┘      └──────────┬──────────┬────────────────┘
               │                             │          │
               │ Read/Write contracts        │ Signed   │ Prisma ORM
               ▼                             │ txns     ▼
┌──────────────────────────────────┐         │   ┌──────────────┐
│    SMART CONTRACTS (Anvil EVM)   │◄────────┘   │  PostgreSQL  │
│    http://127.0.0.1:8545         │             │  :5432       │
│                                  │             │  positions,  │
│  Oracle ← MarketState ← Trading │             │  candles,    │
│            /P2PTrading → Custody │             │  events      │
│               ↕           ↕      │             └──────────────┘
│            FeeManager    VAMM    │
│                                  │
│  Tokens: MockUSDC, PMLP, PRPMAN   │
│  Governance → all admin fns      │
└──────────────────────────────────┘
               ▲
               │ HTTP polling (5s)
┌──────────────┴───────────┐
│  AUTONOM ORACLE API      │
│  178.128.21.71:3000      │
│  Gold/Silver/Oil/Plat    │
└──────────────────────────┘
```

---

## Detailed Service Flows

### 1. Price Flow (Autonom → Chain → Same-Tick Keepers → Frontend)

```
Autonom API ──5s loop──► Fetcher ──► PriceStore ──► WebSocket Server ──► Frontend
                              │                              (ws://localhost:8080)
                              │
                              ├──► MarketStateDetector ──► three-state: OPEN → PAUSED → CLOSED
                              │        │
                              │        ├──► CLOSED→OPEN ──► deactivateVAMM
                              │        │                        └──► P2PSettlementKeeper
                              │        │                              (batch settle + sweep)
                              │        │
                              │        └──► OPEN→PAUSED→CLOSED ──► initializeVAMM
                              │
                              ├──► DB: logMarketState() on transitions
                              │
                              └──► ChainPusher ──cache-based decision──► TxSender ──► Oracle.sol
                                        │       (change / heartbeat 180s / skip)
                                        │
                                        └──► LiquidationEngine (post-push)
                                               ├── refreshCustodyStates()
                                               ├── off-chain pre-check
                                               └── Trading.liquidate() (parallel)

              ┌─── INDEPENDENT TIMER (decoupled from pipeline) ───┐
              │                                                     │
              │  FeeAccrualKeeper (every blockTimeMs, default 15s)  │
              │    └──► Custody.accrueFees() × 4                    │
              └─────────────────────────────────────────────────────┘
```

- **Fetcher** polls Autonom every 5s in a sequential `while(true)` loop for 4 feeds (Gold 2056, Silver 2069, CrudeOil 2003, Platinum 2062)
- **ChainPusher** uses cache-based push decision (change detected / heartbeat 180s / skip), signs with `abi.encode` + ECDSA via TxSender, submits to Oracle.sol
- **FeeAccrualKeeper** calls `Custody.accrueFees()` for each custody via independent `blockTimeMs` timer (default 15s), decoupled from the price pipeline
- **LiquidationEngine** runs off-chain pre-check (mirrors Solidity math), submits `liquidate()` txs in parallel
- **Key design**: liquidation runs in the **same tick** as price push, not a separate polling loop
- **MarketStateDetector** uses three-state machine (OPEN, PAUSED, CLOSED) with schedule-based detection, debounce confirmations, and cooldown
- **Boot sequence**: `initOnChainState()` reads on-chain prices, market state, and custody state before starting pipeline
- **PriceStore** aggregates ticks into OHLCV candles (15s, 1m, 5m, 10m, 15m, 30m, 1h, 6h, 12h, 1d) — persisted to PostgreSQL
- **WebSocket Server** broadcasts raw ticks, market state changes, and position updates to frontends
- **REST API** (localhost:3001) serves candles, positions (trading + P2P + history), prices, health

### 2. Market-Hours Trading Flow

```
User ──► Frontend ──► Trading.sol
                          │
                          ├──► Oracle.sol (getPriceIfFresh)
                          ├──► MarketState.sol (isMarketOpen? must be YES)
                          ├──► FeeManager.sol (calculateOpenCloseFee)
                          ├──► Custody.sol (increasePosition / decreasePosition / increaseCollateral / payTrader)
                          └──► Pool.sol (receiveFees / absorbPnL)
```

**Fee-then-size model**: Open fee is calculated on `collateral × leverage` (preliminary size), then deducted from collateral before computing final `sizeUsd = collateralAfterFee × leverage`. Trader gets exact requested leverage with no silent bump.

**Open**: User deposits USDC → Fee deducted → Custody holds collateralAfterFee → `totalTraderCollateral` incremented → Position recorded with fee/funding snapshots
**Close**: Oracle price → PnL calc → Funding applied → Base fee + close fee deducted → Trader paid from Custody → `totalTraderCollateral` decremented
**Add Collateral**: Owner sends USDC → Custody `availableBalance` and `totalTraderCollateral` increase → Position collateral updated (no size/OI/fee-snapshot change)
**Liquidate**: Keeper calls → effective collateral check (PnL + fees + funding) → if < 10% of initial margin → force close (emits `PositionLiquidated` only, no `PositionClosed`)

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
- Same fee-then-size model as market-hours trading

### 4. Market Transition Flow

```
Market Close (three-state transition):
  1. OPEN → PAUSED (fresh=false detected, begin confirmation count)
  2. PAUSED → CLOSED (6 confirmations at 5s = 30s debounce)
  MarketStateDetector ──► MarketState.sol (state → CLOSED)
  MarketStateDetector ──► VAMM.sol (initializeVAMM at last spot price)
  MarketStateDetector ──► DB: logMarketState("closed")
  Main positions: stay open, keep accruing fees, no liquidation
  P2P positions: can now open/close via VAMM

Market Open (three-state transition):
  CLOSED → OPEN (2 confirmations at 5s = 10s debounce)
  MarketStateDetector ──► VAMM.sol (deactivateVAMM)
  MarketStateDetector ──► P2PSettlementKeeper
  KeeperCoordinator: acquires settlement lock (blocks liquidation for this feed)
  P2PSettlementKeeper ──► MarketState.sol (state → OPEN)
  P2PSettlementKeeper ──► P2PTrading.sol (settleP2PBatch in chunks of 50)
  P2PSettlementKeeper ──► P2PTrading.sol (sweepLeftoverUSDC)
  KeeperCoordinator: releases lock → LiquidationEngine resumes for this feed
  MarketStateDetector ──► DB: logMarketState("open")
```

### 5. Keeper Architecture (Tick-Based, Not Polling)

```
┌──────────────────────────────────────────────────────────────────┐
│  PIPELINE (every 5s, sequential while(true) loop)               │
│                                                                  │
│  Fetcher → Store → WS Broadcast → MarketStateDetector            │
│                                          │                       │
│                                   ┌──────┴──────┐               │
│                                   │ Transition? │               │
│                                   └──────┬──────┘               │
│                              CLOSED→OPEN │                       │
│                                   ┌──────▼──────────────────┐   │
│                                   │ P2PSettlementKeeper     │   │
│                                   │  ├─ startSettlement()   │   │
│                                   │  ├─ updateMarketState() │   │
│                                   │  ├─ settleP2PBatch(50)  │   │
│                                   │  ├─ sweepLeftoverUSDC() │   │
│                                   │  └─ endSettlement()     │   │
│                                   └─────────────────────────┘   │
│                                                                  │
│  ChainPusher (cache-based: change/heartbeat 180s/skip)           │
│       │                                                          │
│       └──► TxSender → Oracle.updatePrices()                      │
│               │                                                  │
│               └──► LiquidationEngine.checkAndLiquidateAll()      │
│                       ├─ refreshCustodyStates() (3 reads × 4)   │
│                       ├─ for each feed (skip if settlement)      │
│                       │    ├─ getOpenPositions(feedId)           │
│                       │    ├─ enrichPosition() (lazy RPC)        │
│                       │    └─ isLiquidatable() (off-chain math)  │
│                       └─ Trading.liquidate() × N (parallel)      │
│                                                                  │
│  PositionTracker (DB-backed + event-driven)                      │
│       ├─ Startup: load from PostgreSQL (instant, no replay)     │
│       ├─ Fallback: replay from block 0 if no DB                 │
│       ├─ watchContractEvent(PositionOpened) → Map + DB persist  │
│       ├─ watchContractEvent(PositionClosed) → Map + DB update   │
│       ├─ watchContractEvent(PositionLiquidated) → Map + DB      │
│       ├─ watchContractEvent(CollateralAdded) → Map + DB update  │
│       ├─ watchContractEvent(P2PPositionOpened) → Map + DB       │
│       ├─ watchContractEvent(P2PPositionClosed) → Map + DB       │
│       └─ WebSocket: broadcastPositionUpdate() on each event     │
│                                                                  │
│  PositionReconciler (every max(blockTimeMs×4, 10s))              │
│       ├─ Read all DB positions with status="open"               │
│       ├─ Verify against on-chain state                          │
│       └─ Fix any missed events (update DB status)               │
│                                                                  │
│  ┌── INDEPENDENT TIMER (decoupled from pipeline) ──┐            │
│  │  FeeAccrualKeeper (every blockTimeMs)            │            │
│  │    └─ Custody.accrueFees() × 4 custodies         │            │
│  └──────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────┘
```

- **No separate keeper polling loop** — liquidation runs in the same tick as price push
- **PositionTracker** loads from PostgreSQL on boot (instant), then watches live events
- **KeeperCoordinator** prevents overlap: P2PSettlementKeeper acquires lock, LiquidationEngine skips locked feeds
- **FeeAccrualKeeper** runs on independent `blockTimeMs` timer (default 15s), decoupled from the price pipeline
- **PositionReconciler** runs every `max(blockTimeMs×4, 10s)` to catch any missed events
- All keepers use TxSender for nonce management and transaction confirmation

### 6. LP (Liquidity Provider) Flow

```
User ──► Frontend ──► Pool.sol
                        │
                        ├──► deposit(USDC) → mint PMLP → distribute to Custodies (by allocation %)
                        ├──► withdraw(PMLP) → burn PMLP → waterfall withdraw from Custodies
                        │         └──► WaterfallWithdraw.sol (proportional, then redistribute shortfall)
                        │
                        ├──► receiveFees(amount) → totalPoolUSDC += amount
                        └──► absorbPnL(impact) → totalPoolUSDC += impact (can be negative)
```

- **PMLP price** = totalPoolUSDC / PMLP.totalSupply (increases as fees accrue, traders lose)
- **All USDC lives in Custodies** — Pool.sol is accounting only
- **4 Custodies**: Gold, Silver, CrudeOil, Platinum — each with independent OI and fee accumulators

### 7. Fee & Funding Flow

```
                    ┌─── Base Fee (both sides pay) ───► Pool/LPs (90%) + Protocol (10%)
                    │    Utilization-based: sideOI / lpLiquidity
                    │    (excludes trader collateral from denominator)
                    │
Custody.accrueFees()├─── Funding Rate (zero-sum) ───► Pool as intermediary
(every 15s)         │       Long pays → Pool gains    (net zero when balanced)
                    │       Short receives → Pool loses
                    │
                    └─── Open/Close Fee (0.1%) ───► Pool/LPs (90%) + Protocol (10%)
                         Calculated on preliminary size, deducted from collateral
```

- **FeeAccrualKeeper** triggers `Custody.accrueFees()` on-chain every `blockTimeMs` (default 15s) via independent timer
- **Base fee rate** (5 bps/hr = 0.05%/hr): uses LP-only liquidity (`availableBalance - totalTraderCollateral`) as denominator to prevent trader collateral from suppressing fee rates. Configured as hourly bps, divided by 240 intervals/hr internally.
- **Funding rate** (5 bps/hr = 0.05%/hr): configured as hourly bps (`maxFundingRatePerHourBps`), divided by 240 intervals/hr internally. At 100x leverage, 5 bps/hr on notional = 5%/hr of collateral.
- **totalTraderCollateral**: tracked separately in Custody — incremented on position open or addCollateral, decremented on close/liquidation
- Funding rate drives OI rebalancing: longs pay shorts when longOI > shortOI, vice versa

### 8. Liquidation Pre-Check Math (Off-Chain, Mirrors Solidity)

```
PnL:
  priceDelta = isLong ? (currentPrice - entryPrice) : (entryPrice - currentPrice)
  pnl = (sizeUsd × |priceDelta|) / entryPrice

Base Fees:
  accum = isLong ? custody.cumulativeLongBaseFeePerUnit : ...Short...
  accumulatedFees = ((accum - snapshot) × sizeUsd) / 10^18

Funding:
  delta = custody.cumulativeFundingPerUnit - fundingSnapshot
  signedDelta = isLong ? delta : -delta
  accumulatedFunding = (signedDelta × sizeUsd) / 10^18

Effective Collateral:
  effective = collateral - fees - funding ± PnL
  LIQUIDATABLE if effective < (collateral × 10%) / 100%
```

### 9. Governance Flow

```
PRPMAN holder ──► Governance.sol
                    │
                    ├──► propose(target, callData) — any admin function on any contract
                    ├──► vote(proposalId, support) — PRPMAN-weighted, 48hr window
                    └──► execute(proposalId) — requires 20% quorum + 51% majority
                              │
                              └──► target.call(callData) — changes any parameter:
                                   custody allocations, fee rates, VAMM depth,
                                   oracle signer, max leverage, pause/unpause, upgrades
```

### 10. Contract Dependency Graph

```
                    ┌──────────┐
                    │ Oracle   │◄──── ChainPusher (off-chain, abi.encode + ECDSA)
                    └────┬─────┘
                         │ getPriceIfFresh()
                    ┌────▼─────┐
                    │MarketState│◄──── MarketStateDetector (off-chain, debounced)
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
     ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐
     │Custody  │ │Custody  │ │Custody  │ │Custody   │
     │(Gold)   │ │(Silver) │ │(Oil)    │ │(Platinum)│
     └─────────┘ └─────────┘ └─────────┘ └──────────┘
          │           │           │           │
          └───────────┴───────────┴───────────┘
              All USDC lives here
              totalTraderCollateral tracked per custody
              lpLiquidity() = availableBalance - totalTraderCollateral

     ┌───────────┐
     │Governance  │───► ANY admin function on ANY contract
     └───────────┘
```

### 11. Data Persistence Flow

```
Chain Events (Trading + P2P contracts)
    ↓ (watchContractEvent)
PositionTracker
    ├─→ In-memory Map (instant reads for keepers)
    ├─→ PostgreSQL via Prisma (durable, async)
    ├─→ WebSocket broadcast (real-time to frontend)
    └─→ REST API (on-demand queries with filters)

PositionReconciler (every max(blockTimeMs×4, 10s))
    ├─→ Read DB open positions
    ├─→ Verify against chain state
    └─→ Fix any missed events

Frontend
    ├─→ Fetches positions from REST API (not chain scanning)
    ├─→ WebSocket for real-time position updates
    └─→ Manual refresh re-fetches from API
```

### 12. Oracle Service File Map

```
oracle/src/
├── index.ts                          ← Main pipeline: fetch → store → WS → detect → push → keepers
├── config/
│   ├── index.ts                      ← Env vars, feed IDs, contract addresses, custody addresses
│   └── chains.ts                     ← Creditcoin chain definitions (local/testnet/mainnet)
├── abi/
│   └── index.ts                      ← Contract ABIs: Trading, P2PTrading, Custody, Oracle, MarketState, VAMM
├── services/
│   ├── fetcher.ts                    ← 5s sequential loop, Autonom API
│   ├── chainPusher.ts                ← Cache-based push decision (change/heartbeat/skip), signs via ECDSA
│   ├── marketStateDetector.ts        ← Three-state machine (OPEN/PAUSED/CLOSED), schedule + debounce + cooldown
│   ├── priceStore.ts                 ← In-memory + DB candle storage (15s, 1m, 5m, 10m, 15m, 30m, 1h, 6h, 12h, 1d)
│   ├── scheduleProvider.ts           ← Per-feed market hours schedule
│   ├── txSender.ts                   ← Nonce management, retry + confirmation
│   ├── websocketServer.ts            ← WS broadcast: prices, market state, position updates
│   └── database.ts                   ← Prisma client: price ticks, candles, positions, market state, keeper events
├── keepers/
│   ├── positionTracker.ts            ← DB-backed startup + live event watching (Trading + P2P)
│   ├── positionReconciler.ts         ← Periodic chain reconciliation sweep (max(blockTimeMs×4, 10s))
│   ├── liquidationEngine.ts          ← Off-chain pre-check + parallel Trading.liquidate() txs
│   ├── feeAccrualKeeper.ts           ← Custody.accrueFees() every blockTimeMs (independent timer)
│   ├── p2pSettlementKeeper.ts        ← Batch P2P settlement on market open (50/tx + sweep)
│   └── keeperCoordinator.ts          ← Settlement lock (prevents liquidation during settlement)
├── types/
│   └── index.ts                      ← PriceTick, MarketStateUpdate, Position, P2PPosition, CustodyState
└── utils/
    ├── logger.ts                     ← Structured logging with levels
    ├── signing.ts                    ← Wallet client + ECDSA batch signing (encodeAbiParameters)
    └── retry.ts                      ← Exponential backoff retry helper
```

---

## Port Map

| Service | Port | Protocol |
|---------|------|----------|
| Frontend | localhost:3000 | HTTP |
| Oracle REST API | localhost:3001 | HTTP |
| Oracle WebSocket | localhost:8080 | WS |
| Anvil RPC | 127.0.0.1:8545 | HTTP/JSON-RPC |
| PostgreSQL | localhost:5432 | TCP |

## Startup Order

```
1. PostgreSQL                  ← started by start.sh (not auto-start on boot)
2. Anvil (local EVM)           ← must be before contracts
3. Deploy contracts            ← DeployLocal.s.sol
4. Oracle Service              ← reads env vars for addresses, connects to Autonom + Anvil + PostgreSQL
   a. Boot: DB init → WS → REST → PositionTracker (load from DB) → event watchers → reconciler
   b. Init: initOnChainState() → reads on-chain prices, market state, custody state
   c. Timer: Independent FeeAccrualKeeper timer (every blockTimeMs)
   d. Run:  Sequential while(true) loop (5s) → fetch → store → detect → push → keepers
5. Frontend                    ← connects to Oracle WS + Anvil RPC
```

All orchestrated by `./start.sh`.

## Timing Budget

| Step | Operation | Latency | Notes |
|------|-----------|---------|-------|
| 1 | fetchPrices() | ~50ms | HTTP to Autonom, 5s timeout |
| 2 | storePriceTicks() | <1ms | In-memory + async DB write |
| 3 | broadcastPrices() | <1ms | WS push, sync |
| 4 | detectMarketStateChanges() | <1ms | Three-state machine with schedule check |
| 5 | Cache-based push decision | <1ms | Compare vs cached prices + heartbeat check |
| 6 | signPriceBatch() | ~3ms | keccak256(abi.encode) + ECDSA (if pushing) |
| 7 | simulateContract() | ~30ms | eth_call (if pushing) |
| 8 | writeContract(updatePrices) | ~100ms | tx mine (Anvil instant, if pushing) |
| 9 | refreshCustodyStates() | ~20ms | 12 parallel reads |
| 10 | isLiquidatable() × N | <1ms×N | Pure math, no RPC |
| 11 | Trading.liquidate() × M | ~100ms | Parallel via allSettled |
| **Total (normal tick)** | | **~300ms** | Well within 5s budget |
| **Total (skip tick)** | | **~55ms** | When cache says no push needed |
| **Total (settlement tick)** | | **2–30s** | Rare: 2×/day/feed, blocks tick |
| **Fee accrual (independent)** | | **~200ms** | Every blockTimeMs, 4 parallel txs |

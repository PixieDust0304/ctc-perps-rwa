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

### 1. Price Flow (Autonom → Chain → Same-Tick Keepers → Frontend)

```
Autonom API ──0.5s poll──► Fetcher ──► PriceStore ──► WebSocket Server ──► Frontend
                              │                              (ws://localhost:8080)
                              │
                              ├──► MarketStateDetector ──► detect CLOSED→OPEN
                              │        │                        │
                              │        │                        └──► P2PSettlementKeeper
                              │        │                              (batch settle + sweep)
                              │        │
                              │        └──► detect OPEN→CLOSED ──► initializeVAMM
                              │
                              └──► ChainPusher ──ECDSA sign──► Oracle.sol (updatePrices)
                                        │
                                        │  ┌─── POST-PUSH HOOKS (same tick) ───┐
                                        │  │                                    │
                                        ├──► FeeAccrualKeeper (every 15s)       │
                                        │      └──► Custody.accrueFees() × 4    │
                                        │                                       │
                                        └──► LiquidationEngine                  │
                                               ├── refreshCustodyStates()       │
                                               ├── off-chain pre-check          │
                                               └── Trading.liquidate() (parallel)
                                            └───────────────────────────────────┘
```

- **Fetcher** polls Autonom every 500ms for 4 feeds (Gold 2056, Silver 2069, Copper 2015, Platinum 2062)
- **ChainPusher** signs price batch with ECDSA private key, submits to Oracle.sol, then runs post-push hooks
- **FeeAccrualKeeper** calls `Custody.accrueFees()` for each custody, throttled to every 15s
- **LiquidationEngine** runs off-chain pre-check (mirrors Solidity math), submits `liquidate()` txs in parallel
- **Key design**: liquidation runs in the **same tick** as price push, not a separate polling loop (<500ms latency)
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
**Liquidate**: Keeper calls → effective collateral check (PnL + fees + funding) → if < 30% margin → force close

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
  MarketStateDetector ──► P2PSettlementKeeper
  KeeperCoordinator: acquires settlement lock (blocks liquidation for this feed)
  P2PSettlementKeeper ──► MarketState.sol (state → OPEN)
  P2PSettlementKeeper ──► P2PTrading.sol (settleP2PBatch in chunks of 50)
  P2PSettlementKeeper ──► P2PTrading.sol (sweepLeftoverUSDC)
  KeeperCoordinator: releases lock → LiquidationEngine resumes for this feed
```

### 5. Keeper Architecture (Tick-Based, Not Polling)

```
┌──────────────────────────────────────────────────────────────────┐
│  TICK PIPELINE (every 500ms)                                     │
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
│  ChainPusher → Oracle.updatePrices()                             │
│       │                                                          │
│       ├──► FeeAccrualKeeper.maybeTriggerAccrual()               │
│       │       └─ Custody.accrueFees() × 4 (if ≥15s elapsed)    │
│       │                                                          │
│       └──► LiquidationEngine.checkAndLiquidateAll()             │
│               ├─ refreshCustodyStates() (3 reads × 4 feeds)    │
│               ├─ for each feed (skip if settlement in progress) │
│               │    ├─ getOpenPositions(feedId)                  │
│               │    ├─ enrichPosition() (lazy RPC if needed)     │
│               │    └─ isLiquidatable() (off-chain math)         │
│               └─ Trading.liquidate() × N (parallel)             │
│                                                                  │
│  PositionTracker (background, event-driven)                      │
│       ├─ watchContractEvent(PositionOpened) → add to Map        │
│       ├─ watchContractEvent(PositionClosed) → remove from Map   │
│       └─ watchContractEvent(PositionLiquidated) → remove        │
└──────────────────────────────────────────────────────────────────┘
```

- **No separate keeper polling loop** — liquidation runs in the same tick as price push
- **PositionTracker** replays all historical events on boot (`getLogs` from block 0), then watches live
- **KeeperCoordinator** prevents overlap: P2PSettlementKeeper acquires lock, LiquidationEngine skips locked feeds
- **FeeAccrualKeeper** throttled to 15s intervals (CTC block time), skips if called too early
- All keepers use the same Anvil RPC signer (oracle service private key)

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

- **FeeAccrualKeeper** triggers `Custody.accrueFees()` on-chain every 15s via post-push hook
- Base fee rate depends on OI imbalance (GMX-style: more OI = higher fee for that side)
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
  LIQUIDATABLE if effective < (collateral × 30%) / 100%
```

### 9. Governance Flow

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

### 10. Contract Dependency Graph

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

### 11. Oracle Service File Map

```
oracle/src/
├── index.ts                          ← Main pipeline: fetch → store → WS → detect → push → keepers
├── config/
│   ├── index.ts                      ← Env vars, feed IDs, contract addresses, custody addresses
│   └── chains.ts                     ← Creditcoin chain definitions (local/testnet/mainnet)
├── abi/
│   └── index.ts                      ← Contract ABIs: Trading, P2PTrading, Custody, Oracle, MarketState, VAMM
├── services/
│   ├── fetcher.ts                    ← Polls Autonom API every 500ms
│   ├── chainPusher.ts                ← Signs & pushes prices, runs post-push hooks (fees + liquidation)
│   ├── marketStateDetector.ts        ← Detects fresh flag transitions per feed
│   ├── priceStore.ts                 ← In-memory + DB candle storage (15s, 1m, 5m, 15m, 1h)
│   ├── websocketServer.ts            ← WS broadcast to frontends
│   └── database.ts                   ← Prisma PostgreSQL client (optional, fallback to in-memory)
├── keepers/
│   ├── positionTracker.ts            ← Event replay (block 0) + live watchContractEvent for positions
│   ├── liquidationEngine.ts          ← Off-chain pre-check + parallel Trading.liquidate() txs
│   ├── feeAccrualKeeper.ts           ← Custody.accrueFees() every 15s (throttled)
│   ├── p2pSettlementKeeper.ts        ← Batch P2P settlement on market open (50/tx + sweep)
│   └── keeperCoordinator.ts          ← Settlement lock (prevents liquidation during settlement)
├── types/
│   └── index.ts                      ← PriceTick, MarketStateUpdate, Position, CustodyState
└── utils/
    ├── logger.ts                     ← Structured logging with levels
    ├── signing.ts                    ← Wallet client + ECDSA batch signing
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
| PostgreSQL | localhost:5432 | TCP (optional) |

## Startup Order

```
1. Anvil (local EVM)           ← must be first
2. Deploy contracts            ← DeployLocal.s.sol
3. Oracle Service              ← reads env vars for addresses, connects to Autonom + Anvil
   a. Boot: DB → WS → REST → PositionTracker replay → event watchers
   b. Run:  Fetch loop (500ms) → pipeline → keepers
4. Frontend                    ← connects to Oracle WS + Anvil RPC
```

All orchestrated by `./start.sh`.

## Timing Budget

| Step | Operation | Latency | Notes |
|------|-----------|---------|-------|
| 1 | fetchPrices() | ~50ms | HTTP to Autonom, 5s timeout |
| 2 | storePriceTicks() | <1ms | In-memory |
| 3 | broadcastPrices() | <1ms | WS push, sync |
| 4 | detectMarketStateChanges() | <1ms | In-memory compare |
| 5 | signPriceBatch() | ~3ms | keccak256 + ECDSA |
| 6 | simulateContract() | ~30ms | eth_call |
| 7 | writeContract(updatePrices) | ~100ms | tx mine (Anvil instant) |
| 8 | maybeTriggerAccrual() | 0–200ms | 0 if <15s; ~200ms if firing (4 parallel txs) |
| 9 | refreshCustodyStates() | ~20ms | 12 parallel reads |
| 10 | isLiquidatable() × N | <1ms×N | Pure math, no RPC |
| 11 | Trading.liquidate() × M | ~100ms | Parallel via allSettled |
| **Total (normal tick)** | | **~300ms** | Well within 500ms budget |
| **Total (settlement tick)** | | **2–30s** | Rare: 2×/day/feed, blocks tick |

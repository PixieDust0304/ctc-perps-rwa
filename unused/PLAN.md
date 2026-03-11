# pErp-man: Implementation Plan

## Context

Building a commodities perpetual futures platform on CreditCoin chain. Pool-vs-traders model during market hours, P2P speculation during off-hours. 4 markets (Gold, Silver, Crude Oil, Platinum) with Autonom RWA oracle. Localnet only for v1.

## Monorepo Structure

```
ctc-perps/
  contracts/              # Foundry - Solidity smart contracts
    src/
      interfaces/
        IOracle.sol
        IPool.sol
        ICustody.sol
        ITrading.sol
        IP2PTrading.sol
        IVAMM.sol
        IGovernance.sol
      libraries/
        FixedPointMath.sol        # 18-decimal fixed-point arithmetic
        FeeCalculator.sol         # Base fee + funding rate math
        PriceUtils.sol            # Oracle price conversion (expo -10 -> 18 decimals)
        PositionUtils.sol         # PnL, margin, liquidation calculations
        WaterfallWithdraw.sol     # LP waterfall withdrawal algorithm
      tokens/
        MockUSDC.sol              # ERC-20, 18 decimals, mint/burn by owner
        PMLP.sol                   # LP receipt token, UUPS
        PRPMAN.sol                 # Governance token, standard ERC-20
      core/
        Oracle.sol                # Price storage + ECDSA verification (abi.encode), UUPS
        Pool.sol                  # Single pool, LP deposit/withdraw, UUPS
        Custody.sol               # Per-commodity custody (deployed 4x), UUPS
        Trading.sol               # Market-hours trading engine, UUPS
        P2PTrading.sol            # Off-hours P2P trading engine, UUPS
        VAMM.sol                  # Virtual AMM per commodity, UUPS
        FeeManager.sol            # Fee accrual + distribution, UUPS
        MarketState.sol           # Per-feed open/close state machine, UUPS
      governance/
        Governance.sol            # PRPMAN-weighted voting, UUPS
      deploy/
        DeployLocal.s.sol         # Anvil deployment script
    test/
      unit/                       # Per-contract unit tests
      integration/                # Cross-contract lifecycle tests
      invariant/                  # Property-based invariant tests
      helpers/
        TestSetup.sol
    foundry.toml
  oracle/                 # TypeScript - Oracle + Keepers + DB
    src/
      config/
        index.ts                  # env vars, chain config, feed IDs
        chains.ts                 # CreditCoin chain definitions
      services/
        fetcher.ts                # 5s sequential loop, Autonom API
        priceStore.ts             # OHLCV aggregation, in-memory + Prisma persistence
        chainPusher.ts            # Cache-based push decision (change/heartbeat/skip), signs via ECDSA
        marketStateDetector.ts    # Three-state machine (OPEN/PAUSED/CLOSED), schedule + debounce + cooldown
        scheduleProvider.ts       # Per-feed market hours schedule
        txSender.ts               # Nonce management, retry + confirmation
        websocketServer.ts        # WS server: prices, market state, position updates
        database.ts               # Prisma client: ticks, candles, positions, market state, events
      keepers/
        liquidationEngine.ts      # Off-chain pre-check + parallel liquidate()
        feeAccrualKeeper.ts       # Custody.accrueFees() every 15s
        p2pSettlementKeeper.ts    # Batch settle at market open (50/tx + sweep)
        keeperCoordinator.ts      # No overlap between keepers
        positionTracker.ts        # DB-backed startup + live event watching (Trading + P2P)
        positionReconciler.ts     # Periodic chain-vs-DB reconciliation sweep (max(blockTimeMs×4, 10s))
      utils/
        signing.ts                # encodeAbiParameters + ECDSA wallet
        logger.ts
        retry.ts
      types/
        index.ts
      index.ts
    prisma/
      schema.prisma
    package.json
    tsconfig.json
  frontend/               # Next.js - Trading UI
    src/
      app/
        layout.tsx
        page.tsx                  # Main trading dashboard
        pool/page.tsx             # LP deposit/withdraw
        governance/page.tsx       # DAO proposals
      components/
        AppSidebar.tsx            # Sidebar navigation (Trade/Pool/Govern)
        Footer.tsx                # Footer with credits and links
        PixelTransition.tsx       # Pixel-based page transition animation
        trading/
          PriceChart.tsx          # Lightweight Charts v4 (1m-1Y intervals)
          OrderPanel.tsx          # Open position form
          PositionsPanel.tsx      # All positions (trading + P2P + history tabs)
          P2PPositionList.tsx     # P2P positions (via API, WS updates)
          MarketSelector.tsx      # Asset tabs with liquidity tooltip on hover
          MarketStatusBanner.tsx  # OPEN/CLOSED + P2P warning
          FaucetButton.tsx        # Mint test USDC
          PnLPopup.tsx            # PnL details modal on position close
          CustodyLiquidity.tsx    # Custody liquidity display
        pool/
          PoolPanel.tsx           # LP deposit/withdraw/stats (single component)
        governance/
          GovernancePanel.tsx     # Proposals, voting, execution (single component)
      hooks/
        usePrices.ts              # WebSocket: prices, market state, positions
      lib/
        contracts.ts              # Addresses + ABIs + feed config
        wagmiConfig.ts            # wagmi + RainbowKit config
    package.json
    next.config.js
    tailwind.config.js
  start.sh                  # One-command startup (PostgreSQL + Anvil + deploy + oracle + frontend)
  .addresses.json           # Deployed contract addresses (generated)
```

## Contract Architecture

### Proxy Pattern
All core contracts: UUPS (ERC-1967) via OpenZeppelin `UUPSUpgradeable` + `OwnableUpgradeable` + `ReentrancyGuardUpgradeable` + `PausableUpgradeable`.

### Key Storage Layouts

**Oracle.sol**
- `mapping(uint16 => PriceData) prices` — feed_id => {price(18dec), timestamp, fresh}
- `address trustedSigner` — ECDSA signer
- `uint256 stalenessThreshold` — 210 seconds
- Signature verification uses `abi.encode` (not `encodePacked`) to prevent hash collisions with dynamic arrays

**Pool.sol**
- `address usdc, pmlpToken, protocolFeeReceiver`
- `uint256 totalPoolUSDC`
- `address[] custodies` — 4 custody contract addresses
- `mapping(address => uint256) custodyAllocationBps` — DAO-set ratios
- Checks-effects-interactions: state updated before external calls in withdraw()

**Custody.sol** (deployed 4x)
- `uint16 feedId`
- `uint256 availableBalance, reservedBalance`
- `uint256 longOpenInterest, shortOpenInterest`
- `uint256 totalTraderCollateral` — tracks trader deposits separately from LP liquidity
- `uint256 cumulativeLongBaseFeePerUnit, cumulativeShortBaseFeePerUnit` — GMX-style accumulators
- `int256 cumulativeFundingPerUnit` — signed: positive = longs pay shorts, negative = shorts pay longs
- `uint256 lastAccrualTimestamp`
- `lpLiquidity()` view: returns `availableBalance - totalTraderCollateral` (fee rate denominator)

**Trading.sol**
- `Position` struct: owner, feedId, isLong, collateral, sizeUsd, entryPrice, openTimestamp, `uint256 cumulativeBaseFeeSnapshot`, `int256 cumulativeFundingSnapshot`
- `mapping(bytes32 => Position) positions`
- Config: maxLeverage=100x, maintenanceMarginBps=1000 (10%), openCloseFee=10bps (0.1%), minPositionOpenTime=300s
- Fee-then-size model: `prelimSize = collateral × leverage`, `openFee = prelimSize × feeBps`, `sizeUsd = (collateral - openFee) × leverage`

**P2PTrading.sol**
- `P2PPosition` struct: same as Position + entryVammPrice, isSettled
- `mapping(uint16 => uint256) p2pEscrowBalance` — per-feed P2P pool
- `mapping(uint16 => uint256) p2pLongOI, p2pShortOI`
- Checks-effects-interactions: `pos.isSettled = true` before USDC transfers
- minPositionOpenTime = 10s (separate from market-hours 300s)
- Same fee-then-size model as Trading

**VAMM.sol**
- `VirtualPool` struct: virtualBase, virtualQuote, k, depthMultiplier, active
- `mapping(uint16 => VirtualPool) vamms`

**FeeManager.sol**
- `openCloseFeeBps=10 (0.1%), maxBaseFeePerHourBps=500 (5%), maxFundingRatePerIntervalBps=1, lpShareBps=9000 (90%)`

**Governance.sol**
- `Proposal` struct: proposer, callData, target, forVotes, againstVotes, deadline, executed
- Config: quorumBps=2000, majorityBps=5100, votingPeriod=48hrs

### Access Control

| Caller | Can Call |
|--------|---------|
| Anyone | openPosition, closePosition, liquidate, openP2PPosition, closeP2PPosition, deposit, withdraw |
| Oracle Keeper | updatePrices (with valid ECDSA signature) |
| Settlement Keeper | settleP2PBatch |
| MarketState | initializeVAMM, deactivateVAMM |
| Governance (DAO) | ALL admin functions, upgrades |

### Key Formulas

**Fee-then-Size Model (open position)**:
```
prelimSize = collateral × leverage
openFee = prelimSize × feeBps / 10000
collateralAfterFee = collateral - openFee
sizeUsd = collateralAfterFee × leverage     ← trader gets exact requested leverage
```

**Base Fee (per 15s interval, utilization-based)**:
```
lpLiquidity = availableBalance - totalTraderCollateral
rate_for_side = (side_OI / lpLiquidity) * maxBaseFee / 240
fee_owed = position_size * rate_for_side * intervals_elapsed
```
Note: uses LP-only liquidity (excludes trader collateral) to prevent fee rate suppression.

**Funding Rate (per 15s interval)**:
```
funding_rate = (long_OI - short_OI) / (long_OI + short_OI) * max_funding_rate
accumulated_funding = (current_cumulative - snapshot) * position_size  (for longs, inverted for shorts)
positive = trader pays, negative = trader receives
```
Pool acts as intermediary: funding payer's USDC stays in custody (pool gains), funding receiver draws from custody (pool loses). Net zero-sum.

**PnL**:
```
Long:  pnl = sizeUsd * (current_price - entry_price) / entry_price
Short: pnl = sizeUsd * (entry_price - current_price) / entry_price
Cap:   max_payout = min(sizeUsd, custody_available)
```

**Liquidation**:
```
funding_amount = signed (positive = trader pays, negative = trader receives)
effective_collateral = initial_collateral - accumulated_fees - funding_amount +/- unrealized_pnl
liquidatable = effective_collateral < initial_collateral * 10%
```
Note: 10% maintenance margin (1000 bps). At 100x leverage, liquidation triggers at ~0.9% adverse move.

**PMLP Mint/Burn**:
```
pmlp_to_mint = (usdc_deposited / total_pool_usdc) * pmlp_total_supply  (or 1:1 if first deposit)
usdc_to_return = (pmlp_burned / pmlp_total_supply) * total_pool_usdc
```

## Database Schema (Prisma)

```prisma
model PriceTick {
  id        BigInt   @id @default(autoincrement())
  feedId    Int
  price     Decimal  @db.Decimal(78, 0)
  fresh     Boolean
  timestamp DateTime
  @@index([feedId, timestamp])
}

model Candle {
  id        BigInt   @id @default(autoincrement())
  feedId    Int
  interval  String   // "1m", "5m", "15m", "1h"
  open      Decimal  @db.Decimal(78, 0)
  high      Decimal  @db.Decimal(78, 0)
  low       Decimal  @db.Decimal(78, 0)
  close     Decimal  @db.Decimal(78, 0)
  volume    Decimal  @db.Decimal(78, 0) @default(0)
  timestamp DateTime
  @@unique([feedId, interval, timestamp])
}

model MarketStateLog {
  id        BigInt   @id @default(autoincrement())
  feedId    Int
  state     String   // "open", "closed"
  price     Decimal? @db.Decimal(78, 0)
  timestamp DateTime
}

model PositionRecord {
  positionId  String   @id           // bytes32 hex
  type        String                  // "trading" | "p2p"
  owner       String                  // address (lowercase)
  feedId      Int
  isLong      Boolean
  collateral  Decimal  @db.Decimal(78, 0)
  sizeUsd     Decimal  @db.Decimal(78, 0)
  entryPrice  Decimal  @db.Decimal(78, 0)
  status      String   @default("open") // "open" | "closed" | "liquidated" | "settled"
  realizedPnl Decimal? @db.Decimal(78, 0)
  openedAt    DateTime
  closedAt    DateTime?
  txHash      String?
  closeTxHash String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([owner, status])
  @@index([feedId, status])
  @@index([status])
}

model KeeperEvent {
  id           BigInt   @id @default(autoincrement())
  keeperType   String   // "reconciler", "liquidation", "settlement"
  feedId       Int
  action       String
  positionId   String
  txHash       String?
  status       String   // "success", "failed"
  errorMessage String?
  createdAt    DateTime @default(now())
}
```

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| UUPS over Transparent Proxy | Lower gas for users, simpler deployment |
| Cumulative fee accumulators | O(1) fee calc per position vs iterating all positions each block |
| Separate P2PTrading contract | Different pricing, escrow, settlement from main Trading |
| VAMM as separate contract | Independently upgradeable, clean interface |
| MarketState as separate contract | Single source of truth for per-feed state |
| abi.encode for Oracle signatures | Prevents hash collisions with dynamic arrays (encodePacked risk) |
| Fee-then-size model | Deduct open fee from collateral first so sizeUsd reflects exact leverage |
| totalTraderCollateral tracking | Prevents trader deposits from inflating LP liquidity and suppressing fees |
| 10% maintenance margin | Industry standard for commodity perps (30% was too aggressive) |
| PostgreSQL managed by start.sh | Only runs when protocol runs; no background processes on idle machine |
| DB position lifecycle | Full open→close with PnL, tx hashes; 30-min reconciliation catches missed events |
| 18-decimal fixed point everywhere | Matches ERC-20, avoids conversion errors |
| Batch settlement function | Gas efficiency for market-open keeper |

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Oracle downtime | 210s staleness → protocol pause; admin emergency override |
| VAMM whale manipulation | Depth multiplier tuning, 10s min open (P2P), UI warnings |
| Settlement gas costs | Batch function with configurable batch size, keeper retries |
| Reentrancy | ReentrancyGuard + checks-effects-interactions pattern |
| Fee accumulator overflow | uint256 max ~1.15e77; 5%/hr for 100 years = ~4.38e6 — safe |
| Front-running oracle | 300s min open time (market hours); 2s block time reduces MEV |
| Pool drain by winning traders | Payout capped at custody balance; consider ADL for v2 |
| Trader collateral inflating LP metrics | totalTraderCollateral tracked separately; fee rate uses LP-only liquidity |
| DB-chain desync | Periodic reconciler (max(blockTimeMs×4, 10s)) verifies all open positions against chain state |

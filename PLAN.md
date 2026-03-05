# CTC-Perps: Implementation Plan

## Context

Building a commodities perpetual futures platform on CreditCoin chain. Pool-vs-traders model during market hours, P2P speculation during off-hours. 4 markets (Gold, Silver, Copper, Platinum) with Autonom RWA oracle. Localnet only for v1.

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
        CLP.sol                   # LP receipt token, UUPS
        CPERP.sol                 # Governance token, standard ERC-20
      core/
        Oracle.sol                # Price storage + ECDSA verification, UUPS
        Pool.sol                  # Single pool, LP deposit/withdraw, UUPS
        Custody.sol               # Per-commodity custody (deployed 4x), UUPS
        Trading.sol               # Market-hours trading engine, UUPS
        P2PTrading.sol            # Off-hours P2P trading engine, UUPS
        VAMM.sol                  # Virtual AMM per commodity, UUPS
        FeeManager.sol            # Fee accrual + distribution, UUPS
        MarketState.sol           # Per-feed open/close state machine, UUPS
      governance/
        Governance.sol            # CPERP-weighted voting, UUPS
      deploy/
        DeployLocal.s.sol         # Anvil deployment script
    test/
      unit/                       # Per-contract unit tests
      integration/                # Cross-contract lifecycle tests
      invariant/                  # Property-based invariant tests
      helpers/
        TestSetup.sol
        MockOracle.sol
    foundry.toml
    foundry.lock
  oracle/                 # TypeScript - Oracle + Keepers
    src/
      config/
        index.ts                  # env vars, chain config, feed IDs
        chains.ts                 # CreditCoin chain definitions
      services/
        fetcher.ts                # Autonom API polling (0.5s)
        priceStore.ts             # PostgreSQL OHLCV writer
        chainPusher.ts            # Signs + submits prices onchain
        marketStateDetector.ts    # fresh flag transitions per feed
        websocketServer.ts        # WS server for frontend
      keepers/
        mainKeeper.ts             # Market-hours liquidation (0.5s)
        marketOpenKeeper.ts       # Off-hours settlement at market open
        keeperCoordinator.ts      # No overlap between keepers
      utils/
        signing.ts
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
        trading/
          TradingView.tsx         # TradingView Lightweight Charts
          OrderPanel.tsx          # Open position form
          PositionList.tsx        # Active positions table
          MarketSelector.tsx      # Gold/Silver/Copper/Platinum tabs
          MarketStatusBanner.tsx  # OPEN/CLOSED + P2P warning
        pool/
          DepositForm.tsx
          WithdrawForm.tsx
          PoolStats.tsx
        governance/
          ProposalList.tsx
          ProposalForm.tsx
          VoteButton.tsx
        common/
          ConnectWallet.tsx
          Header.tsx
      hooks/
        useWebSocket.ts
        usePrices.ts
        useMarketState.ts
        usePositions.ts
        usePool.ts
        useTrading.ts
      lib/
        chains.ts                 # defineChain for CreditCoin
        contracts.ts              # Addresses + ABIs
        wagmiConfig.ts            # wagmi + RainbowKit config
        chartDataProvider.ts      # OHLCV from API -> chart
      types/
        index.ts
    package.json
    next.config.js
    tailwind.config.js
  database/               # PostgreSQL schema reference
    init.sql
  RAW.md                  # Raw design decisions & cross-checks
  PLAN.md                 # This file
  STATUS.md               # Build progress tracker
```

## Contract Architecture

### Proxy Pattern
All core contracts: UUPS (ERC-1967) via OpenZeppelin `UUPSUpgradeable` + `OwnableUpgradeable` + `ReentrancyGuardUpgradeable` + `PausableUpgradeable`.

### Key Storage Layouts

**Oracle.sol**
- `mapping(uint16 => PriceData) prices` — feed_id => {price(18dec), timestamp, fresh}
- `address trustedSigner` — ECDSA signer
- `uint256 stalenessThreshold` — 10 seconds

**Pool.sol**
- `address usdc, clpToken, protocolFeeReceiver`
- `uint256 totalPoolUSDC`
- `address[] custodies` — 4 custody contract addresses
- `mapping(address => uint256) custodyAllocationBps` — DAO-set ratios

**Custody.sol** (deployed 4x)
- `uint16 feedId`
- `uint256 availableBalance, reservedBalance`
- `uint256 longOpenInterest, shortOpenInterest`
- `uint256 cumulativeBaseFeePerUnit, cumulativeFundingPerUnit` — GMX-style accumulators
- `uint256 lastAccrualTimestamp`

**Trading.sol**
- `Position` struct: owner, feedId, isLong, collateral, sizeUsd, entryPrice, openTimestamp, fee snapshots
- `mapping(bytes32 => Position) positions`
- Config: maxLeverage=100, maintenanceMarginBps=3000, openCloseFee=10bps, minPositionOpenTime=120s

**P2PTrading.sol**
- `P2PPosition` struct: same as Position + entryVammPrice, isSettled
- `mapping(uint16 => uint256) p2pEscrowBalance` — per-feed P2P pool
- `mapping(uint16 => uint256) p2pLongOI, p2pShortOI`

**VAMM.sol**
- `VirtualPool` struct: virtualBase, virtualQuote, k, depthMultiplier, active
- `mapping(uint16 => VirtualPool) vamms`

**FeeManager.sol**
- `maxBaseFeePerHourBps=500, maxFundingRatePerInterval, feeInterval=15, lpShareBps=9000`

**Governance.sol**
- `Proposal` struct: proposer, callData, target, forVotes, againstVotes, deadline, executed
- Config: quorumBps=2000, majorityBps=5100, votingPeriod=48hrs

### Access Control

| Caller | Can Call |
|--------|---------|
| Anyone | openPosition, closePosition, liquidate, openP2PPosition, closeP2PPosition, deposit, withdraw |
| Oracle Keeper | updatePrices (with valid signature) |
| Market Open Keeper | settleP2PBatch |
| MarketState | initializeVAMM, deactivateVAMM |
| Governance (DAO) | ALL admin functions, upgrades |

### Key Formulas

**Base Fee (per 15s interval)**:
```
rate_for_side = (side_OI / total_OI) * 5% / 240
fee_owed = position_size * rate_for_side * intervals_elapsed
```

**Funding Rate (per 15s interval)**:
```
funding_rate = (long_OI - short_OI) / (long_OI + short_OI) * max_funding_rate
majority_pays = position_size * funding_rate
```

**PnL**:
```
Long:  pnl = collateral * leverage * (current_price - entry_price) / entry_price
Short: pnl = collateral * leverage * (entry_price - current_price) / entry_price
Cap:   max_payout = min(collateral * leverage, custody_available)
```

**Liquidation**:
```
effective_collateral = initial_collateral - accumulated_fees - abs(funding_owed) + unrealized_pnl
liquidatable = effective_collateral < initial_collateral * 30%
```

**CLP Mint/Burn**:
```
clp_to_mint = (usdc_deposited / total_pool_usdc) * clp_total_supply  (or 1:1 if first deposit)
usdc_to_return = (clp_burned / clp_total_supply) * total_pool_usdc
```

## Database Schema (Prisma)

```prisma
model PriceTick {
  id        BigInt   @id @default(autoincrement())
  feedId    Int
  price     Decimal  @db.Decimal(38, 18)
  fresh     Boolean
  timestamp DateTime
  @@index([feedId, timestamp])
}

model Candle {
  id        BigInt   @id @default(autoincrement())
  feedId    Int
  interval  String   // "15s", "1m", "5m", "15m", "1h"
  open      Decimal  @db.Decimal(38, 18)
  high      Decimal  @db.Decimal(38, 18)
  low       Decimal  @db.Decimal(38, 18)
  close     Decimal  @db.Decimal(38, 18)
  volume    Decimal  @db.Decimal(38, 18) @default(0)
  timestamp DateTime
  @@unique([feedId, interval, timestamp])
}

model MarketStateLog {
  id        BigInt   @id @default(autoincrement())
  feedId    Int
  state     String   // "open", "closing", "closed", "opening"
  price     Decimal? @db.Decimal(38, 18)
  timestamp DateTime
}

model KeeperEvent {
  id           BigInt   @id @default(autoincrement())
  keeperType   String   // "main", "market_open"
  feedId       Int
  action       String   // "liquidation", "settlement"
  positionId   String
  txHash       String?
  status       String   // "pending", "success", "failed"
  errorMessage String?
  createdAt    DateTime @default(now())
}
```

## Build Phases

### Phase 1: Foundation
- Restructure repo into monorepo
- Install OpenZeppelin upgradeable contracts
- Write: FixedPointMath, PriceUtils, MockUSDC, CLP, CPERP, Oracle
- Unit tests for all above
- **Exit**: Tokens deploy on Anvil. Oracle accepts/rejects signed price updates.

### Phase 2: Pool & Custody
- Write: Pool, WaterfallWithdraw, Custody, FeeManager, MarketState
- Integration: Pool deploys 4 Custodies
- Unit tests: deposit, withdraw waterfall, fee accrual math
- **Exit**: LP deposit/withdraw works. Fee accumulators update correctly.

### Phase 3: Market-Hours Trading
- Write: Trading (openPosition, closePosition, liquidate)
- Wire to Custody, Oracle, FeeManager
- PnL with all caps, liquidation check, 120s timer
- Unit + integration tests: multiple traders, OI tracking, custody balance changes
- **Exit**: Full trading lifecycle works. Fees accrue. PnL capped. Liquidation triggers correctly.

### Phase 4: Off-Hours P2P
- Write: VAMM, P2PTrading
- VAMM price impact, P2P open/close, base fee to main pool, funding between P2P traders
- settleAllAtMarketOpen batch function
- Wire MarketState transitions to VAMM
- Integration test: full off-hours cycle
- **Exit**: Complete off-hours lifecycle. Settlement handles all edge cases.

### Phase 5: Governance
- Write: Governance (propose, vote, execute)
- Wire to all admin functions
- **Exit**: DAO can change every admin parameter.

### Phase 6: Oracle Service
- Initialize TypeScript project with Prisma
- Build: Fetcher, PriceStore, ChainPusher, MarketStateDetector, WebSocket server
- Build: MainKeeper, MarketOpenKeeper, KeeperCoordinator
- REST API for candle data
- **Exit**: Oracle runs continuously. Prices flow Autonom -> chain. Keepers work. WS broadcasts.

### Phase 7: Frontend
- Initialize Next.js + Tailwind + wagmi + viem + RainbowKit
- CreditCoin chain config (defineChain)
- Chart, trading panel, position management, LP interface, market status UI, governance
- **Exit**: Full trading UI works with wallet connection and real-time updates.

### Phase 8: Integration & Deployment
- DeployLocal.s.sol deployment script
- Startup script: Anvil + deploy + PostgreSQL + oracle + frontend
- E2E testing, gas optimization
- **Exit**: Single command starts entire stack locally.

## Testing Strategy

### Unit Tests (forge test)
- Oracle: signature verification, staleness, fresh flag
- Pool: CLP mint/burn math, waterfall withdrawal edge cases
- Custody: balance tracking, OI updates
- Trading: PnL calculation, fee deduction, liquidation threshold, 120s timer
- FeeManager: accumulator math (hourly/240 per interval), 90/10 split
- VAMM: price impact proportional to size, k-invariant maintained
- P2PTrading: escrow accounting, settlement pro-rata, negative equity capped
- Governance: quorum, majority, execution

### Integration Tests
- FullLifecycle: deposit LP -> trade -> accrue fees -> close -> withdraw shows fee income
- MarketTransition: market hours -> close -> P2P -> open -> settlement -> main resumes
- LiquidationScenarios: various leverages, correct trigger prices
- CustodyDrain: winning traders drain custody -> new positions fail -> waterfall handles empty

### Invariant Tests
- totalPoolUSDC == sum(custody balances) always
- CLP.totalSupply > 0 implies totalPoolUSDC > 0
- position.collateral > 0 for all open positions
- p2pEscrowBalance >= sum(P2P collateral) per feed

### Oracle Service Tests
- Unit: mocked Autonom responses (Vitest)
- Integration: real Anvil chain
- WebSocket: message format and frequency

### Frontend Tests
- Component tests (React Testing Library)
- E2E (Playwright against local stack)

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| UUPS over Transparent Proxy | Lower gas for users, simpler deployment |
| Cumulative fee accumulators | O(1) fee calc per position vs iterating all positions each block |
| Separate P2PTrading contract | Different pricing, escrow, settlement from main Trading |
| VAMM as separate contract | Independently upgradeable, clean interface |
| MarketState as separate contract | Single source of truth for per-feed state |
| Prisma ORM | Mature migrations, auto-generated TS types |
| 18-decimal fixed point everywhere | Matches ERC-20, avoids conversion errors |
| Batch settlement function | Gas efficiency for market-open keeper |

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Oracle downtime | 10s staleness -> protocol pause; admin emergency override |
| VAMM whale manipulation | Depth multiplier tuning, 120s min open, UI warnings |
| Settlement gas costs | Batch function with configurable batch size, keeper retries |
| Reentrancy | ReentrancyGuard + checks-effects-interactions pattern |
| Fee accumulator overflow | uint256 max ~1.15e77; 5%/hr for 100 years = ~4.38e6 — safe |
| Front-running oracle | 120s min open time; 15s block time reduces MEV |
| Pool drain by winning traders | Payout capped at custody balance; consider ADL for v2 |

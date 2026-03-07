# pErp-man: Build Status

## Current Phase: Production-Ready v1 — Economics Hardened + DB Persistence

## Progress Tracker

### Phase 1: Foundation ✅
- [x] Restructure repo into monorepo (contracts/, oracle/, frontend/)
- [x] Move Foundry files under contracts/
- [x] Install OpenZeppelin upgradeable contracts
- [x] FixedPointMath.sol library
- [x] PriceUtils.sol library
- [x] MockUSDC.sol
- [x] PMLP.sol (UUPS)
- [x] PRPMAN.sol
- [x] Oracle.sol (UUPS, ECDSA verification, staleness, fresh flag)
- [x] Unit tests for Phase 1 (34 tests)

### Phase 2: Pool & Custody ✅
- [x] Pool.sol (deposit/withdraw, PMLP mint/burn)
- [x] WaterfallWithdraw.sol library
- [x] Custody.sol (per-commodity, 4 instances)
- [x] FeeManager.sol (cumulative accumulators)
- [x] MarketState.sol (per-feed state machine)
- [x] Wire Pool -> Custodies
- [x] Unit tests for Phase 2 (15 tests)

### Phase 3: Market-Hours Trading ✅
- [x] Trading.sol (open, close, liquidate)
- [x] Wire Trading -> Custody, Oracle, FeeManager
- [x] PnL calculation with caps
- [x] Liquidation at 10% maintenance margin (1000 bps)
- [x] 300s min position open time (market hours)
- [x] Fee-then-size model: sizeUsd = collateralAfterFee × leverage
- [x] Integration test: multi-trader scenarios (10 tests)

### Phase 4: Off-Hours P2P ✅
- [x] VAMM.sol (x*y=k, multiplier, init/deactivate)
- [x] P2PTrading.sol (open, close, settle)
- [x] P2P escrow pools (separate from main)
- [x] P2P base fee -> main pool (forwarded to custodies)
- [x] settleP2PBatch for market open
- [x] Wire MarketState -> VAMM
- [x] 10s min position open time (P2P, separate from market hours)
- [x] Integration test: full off-hours cycle (7 tests)

### Phase 5: Governance ✅
- [x] Governance.sol (propose, vote, execute)
- [x] Wire to all admin functions
- [x] Unit tests for Phase 5 (7 tests)

### Phase 6: Oracle Service ✅
- [x] Initialize TypeScript project
- [x] PostgreSQL schema (Prisma v5)
- [x] Database service layer (auto-fallback to in-memory if no DB)
- [x] Fetcher (Autonom 0.5s polling)
- [x] PriceStore (OHLCV aggregation, in-memory + Prisma persistence)
- [x] ChainPusher (abi.encode + ECDSA sign + submit)
- [x] MarketStateDetector (fresh flag with debounce + cooldown)
- [x] WebSocket server (prices, market state, position updates)
- [x] LiquidationEngine (off-chain pre-check + parallel liquidate)
- [x] FeeAccrualKeeper (Custody.accrueFees every 15s)
- [x] P2PSettlementKeeper (batch settlement + sweep)
- [x] KeeperCoordinator (no overlap between settlement and liquidation)
- [x] PositionTracker (DB-backed startup + live Trading/P2P event watching)
- [x] PositionReconciler (30-min chain-vs-DB sweep)
- [x] REST API: candles, prices, positions (trading + P2P + history), health
- [x] Market state logging to DB

### Phase 7: Frontend ✅
- [x] Initialize Next.js + Tailwind + wagmi + viem + RainbowKit
- [x] CreditCoin chain config (defineChain)
- [x] WebSocket hook for real-time prices
- [x] Trading panel + order form (OrderPanel)
- [x] Market status UI + P2P warnings (MarketStatusBanner)
- [x] Market selector with live prices + liquidity tooltip on hover
- [x] TradingView Lightweight Charts v4 (PriceChart: 1m, 5m, 10m, 30m, 1h, 6h, 12h, 24h, 7d, 1M, 6M, 1Y)
- [x] Position management (PositionList via API, real-time WS updates)
- [x] LP interface — Pool page (deposit/withdraw/stats)
- [x] Governance interface — vote, execute proposals
- [x] Navigation between Trade/Pool/Govern pages

### Phase 8: Integration & Deployment ✅
- [x] DeployLocal.s.sol script
- [x] Startup script (start.sh — PostgreSQL + Anvil + deploy + oracle + frontend)
- [x] PostgreSQL auto-managed by start.sh (no auto-start on boot)
- [x] .addresses.json output from deploy
- [x] Invariant tests (Pool + Trading + P2P, 11 tests)
- [x] via_ir enabled for complex deploy scripts

### Phase 9: Security Hardening ✅
- [x] Critical bug fix: Fee dust in custody (fee USDC untracked in availableBalance)
- [x] Critical bug fix: PnL not reported to pool (pool.absorbPnL for trader wins/losses)
- [x] Critical bug fix: P2P escrow over-withdrawal (profit capped at other traders' collateral)
- [x] Architecture fix: P2P fees forwarded from pool to custodies (all USDC lives in custodies)
- [x] abi.encodePacked → abi.encode in Oracle signature verification (collision prevention)
- [x] Checks-effects-interactions pattern in Pool.sol and P2PTrading.sol
- [x] FullLifecycleTest — 5 tests: LP deposit → trade → fees → close → LP withdraw
- [x] MarketTransitionTest — 3 tests: market hours → close → P2P → settle
- [x] CustodyDrainTest — 3 tests: payout caps, custody drain, multi-position accounting
- [x] P2PInvariantTest — 3 tests: escrow backed by USDC, USDC conservation, OI bounds
- [x] Slither static analysis — 0 critical findings

### Phase 10: Economics Hardening ✅
- [x] VFR (Variable Funding Rate) enforcement — funding accumulator consumed on close/liquidate
- [x] Signed funding snapshot (int256) preserves direction
- [x] Funding flows through pool as intermediary (zero-sum between traders)
- [x] Liquidation includes funding in effective collateral check
- [x] P2P leftover USDC sweep function (sweepLeftoverUSDC)
- [x] Fee-then-size model: openFee deducted from collateral before computing sizeUsd
- [x] Maintenance margin reduced: 30% → 10% (industry standard for commodity perps)
- [x] totalTraderCollateral tracking in Custody: separates trader collateral from LP liquidity
- [x] Borrow fee rate uses LP-only liquidity (availableBalance - totalTraderCollateral) as denominator
- [x] lpLiquidity() view function on Custody for frontend display
- [x] 3 funding rate tests + updated liquidation/OI tests for new economics

## Test Summary

**126 Solidity tests passing** across 16 test suites:
- `FixedPointMathTest` (8 tests, incl. fuzz)
- `PriceUtilsTest` (5 tests)
- `FeeCalculatorTest` (14 tests)
- `TokensTest` (8 tests)
- `OracleTest` (14 tests)
- `PoolCustodyTest` (19 tests)
- `GovernanceTest` (10 tests)
- `TradingTest` (17 integration tests)
- `P2PTradingTest` (8 integration tests)
- `FullLifecycleTest` (8 integration tests)
- `MarketTransitionTest` (4 integration tests)
- `CustodyDrainTest` (3 integration tests)
- `P2PEscrowDrainTest` (4 integration tests)
- `PoolInvariantTest` (4 invariant tests)
- `TradingInvariantTest` (4 invariant tests)
- `P2PInvariantTest` (4 invariant tests)

**35 Oracle TypeScript tests passing** across 6 test files:
- `fetcher.test.ts` (5 tests)
- `priceStore.test.ts` (8 tests)
- `marketStateDetector.test.ts` (8 tests)
- `feeAccrualKeeper.test.ts` (1 test)
- `liquidationEngine.test.ts` (11 tests)
- `positionTracker.test.ts` (2 tests)

## Critical Bugs Found & Fixed

| Bug | Impact | Fix |
|-----|--------|-----|
| Fee dust in custody | Open fee USDC sent to custody but not tracked in availableBalance | `custody.receiveFees(openFee)` in Trading.openPosition |
| PnL not reported to pool | pool.totalPoolUSDC didn't change on trader wins/losses — LP share price stale | `pool.absorbPnL(pnlImpact)` in Trading._closePosition |
| P2P escrow over-withdrawal | Profitable trader could withdraw own collateral + entire escrow | Cap profit at `escrow - pos.collateral` (other traders' money only) |
| P2P escrow tracker desync | Profitable close only reduced escrow by collateral — escrow > actual USDC | Decrease escrow by `collateral + cappedPnl`; cap payout at contract USDC balance |
| P2P fees stuck in pool | P2P fees sent to pool but not forwarded to custodies | pool.receiveFees distributes P2P fees to custodies |
| settleP2PBatch missing nonReentrant | Batch settlement lacked reentrancy guard | Added nonReentrant modifier |
| VFR never enforced | Funding rate accrued but never consumed on close | `_calculateAccumulatedFunding()` wired into `_closePosition` and `liquidate` |
| Funding snapshot loses sign | `uint256(abs())` lost direction | Store `int256` snapshot directly |
| P2P leftover USDC stuck | Rounding dust stays in contract forever after all closes | `sweepLeftoverUSDC()` sends residual to pool |
| abi.encodePacked collision risk | Oracle signature hash could collide with dynamic arrays | Changed to `abi.encode` in Oracle.sol and oracle signing.ts |
| Trader collateral inflates LP liquidity | Trader deposits counted in availableBalance, suppressing borrow fee rates | `totalTraderCollateral` tracked separately; fee rate uses LP-only liquidity |

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-05 | Use Anvil for localnet | Standard Foundry tooling, CTC is EVM-compatible |
| 2026-03-05 | UUPS proxy pattern | Lower gas, simpler than Transparent Proxy |
| 2026-03-05 | Separate P2PTrading from Trading | Different pricing models, escrow, settlement |
| 2026-03-05 | Cumulative fee accumulators | O(1) per position, GMX-proven pattern |
| 2026-03-05 | Prisma v5 ORM | Stable, auto-generated TS types |
| 2026-03-05 | TradingView Lightweight Charts v4 | Stable addCandlestickSeries API |
| 2026-03-05 | wagmi + viem + RainbowKit | Standard EVM stack, custom chain support |
| 2026-03-05 | All USDC in custodies | Pool is accounting only. Fees, PnL, deposits all flow to custodies. |
| 2026-03-05 | Signed int256 funding | Funding can be positive (pay) or negative (receive). |
| 2026-03-05 | Pool as funding intermediary | Net zero when balanced. Pool keeps residual when imbalanced (GMX pattern). |
| 2026-03-06 | Fee-then-size model | Deduct fee from collateral before computing sizeUsd. Trader gets exact leverage. |
| 2026-03-06 | abi.encode for Oracle signatures | Prevents hash collision with dynamic arrays (encodePacked risk) |
| 2026-03-06 | 10% maintenance margin | Industry standard for commodity perps (0.5-5% buffer at high leverage) |
| 2026-03-06 | totalTraderCollateral separation | Prevents trader deposits from suppressing borrow fee rates |
| 2026-03-06 | PostgreSQL managed by start.sh | No auto-start on boot; only runs when protocol runs |
| 2026-03-06 | DB position lifecycle tracking | Full open→close/liquidate/settle with PnL, tx hashes, reconciliation |

## Blockers

None.

## Future Work (v2)

- ADL (Auto-Deleveraging) for extreme scenarios
- E2E tests (Playwright) for frontend
- Gas optimization pass (forge snapshot)
- CreditCoin devnet deployment
- Replace MockUSDC with bridged USDC
- Team wallet for protocol fee split
- Frontend tests

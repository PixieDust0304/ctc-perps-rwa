# CTC-Perps: Build Status

## Current Phase: Economics Hardened — v1 COMPLETE

## Progress Tracker

### Phase 1: Foundation ✅
- [x] Restructure repo into monorepo (contracts/, oracle/, frontend/, database/)
- [x] Move Foundry files under contracts/
- [x] Install OpenZeppelin upgradeable contracts
- [x] FixedPointMath.sol library
- [x] PriceUtils.sol library
- [x] MockUSDC.sol
- [x] CLP.sol (UUPS)
- [x] CPERP.sol
- [x] Oracle.sol (UUPS, ECDSA verification, staleness, fresh flag)
- [x] Unit tests for Phase 1 (34 tests)

### Phase 2: Pool & Custody ✅
- [x] Pool.sol (deposit/withdraw, CLP mint/burn)
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
- [x] Liquidation at 30% maintenance margin
- [x] 120s min position open time
- [x] Integration test: multi-trader scenarios (10 tests)

### Phase 4: Off-Hours P2P ✅
- [x] VAMM.sol (x*y=k, multiplier, init/deactivate)
- [x] P2PTrading.sol (open, close, settle)
- [x] P2P escrow pools (separate from main)
- [x] P2P base fee -> main pool (forwarded to custodies)
- [x] settleP2PBatch for market open
- [x] Wire MarketState -> VAMM
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
- [x] ChainPusher (ECDSA sign + submit)
- [x] MarketStateDetector (fresh flag)
- [x] WebSocket server
- [x] MainKeeper (liquidation every 0.5s)
- [x] MarketOpenKeeper (batch settlement)
- [x] KeeperCoordinator (no overlap)
- [x] REST API for candles (path-param and query-param styles)
- [x] .env.example

### Phase 7: Frontend ✅
- [x] Initialize Next.js + Tailwind + wagmi + viem + RainbowKit
- [x] CreditCoin chain config (defineChain)
- [x] WebSocket hook for real-time prices
- [x] Trading panel + order form (OrderPanel)
- [x] Market status UI + P2P warnings (MarketStatusBanner)
- [x] Market selector with live prices
- [x] TradingView Lightweight Charts v4 (PriceChart component)
- [x] Position management (PositionList with live PnL)
- [x] LP interface — Pool page (deposit/withdraw/stats)
- [x] Governance interface — vote, execute proposals
- [x] Navigation between Trade/Pool/Govern pages

### Phase 8: Integration & Deployment ✅
- [x] DeployLocal.s.sol script
- [x] Startup script (start.sh — Anvil + deploy + oracle + frontend)
- [x] Oracle .env.example
- [x] .addresses.json output from deploy
- [x] Invariant tests (Pool + Trading + P2P, 11 tests)
- [x] via_ir enabled for complex deploy scripts

### Phase 9: Security Hardening ✅
- [x] Critical bug fix: Fee dust in custody (fee USDC untracked in availableBalance)
- [x] Critical bug fix: PnL not reported to pool (pool.absorbPnL for trader wins/losses)
- [x] Critical bug fix: P2P escrow over-withdrawal (profit capped at other traders' collateral)
- [x] Architecture fix: P2P fees forwarded from pool to custodies (all USDC lives in custodies)
- [x] FullLifecycleTest — 5 tests: LP deposit → trade → fees → close → LP withdraw
- [x] MarketTransitionTest — 3 tests: market hours → close → P2P → settle
- [x] CustodyDrainTest — 3 tests: payout caps, custody drain, multi-position accounting
- [x] P2PInvariantTest — 3 tests: escrow backed by USDC, USDC conservation, OI bounds
- [x] Slither static analysis — 0 critical findings (59 total, all low/informational)

### Phase 10: Economics Hardening ✅
- [x] VFR (Variable Funding Rate) enforcement in Trading.sol — funding accumulator now consumed on close/liquidate
- [x] Signed funding snapshot (int256) in Position struct — preserves direction
- [x] Funding flows through pool as intermediary (zero-sum: long pays → pool gains, short receives → pool loses)
- [x] PositionUtils.effectiveCollateral accepts signed funding (can add or deduct)
- [x] Liquidation includes funding in effective collateral check
- [x] P2P leftover USDC sweep function (sweepLeftoverUSDC)
- [x] P2P invariant handler with close operations (open + close fuzzing)
- [x] 3 new funding rate tests: solo long pays pool, balanced OI zero funding, imbalanced OI dominant pays more

## Test Summary

**111 Solidity tests passing** across 16 test suites:
- `FixedPointMathTest` (8 tests, incl. fuzz)
- `PriceUtilsTest` (5 tests)
- `FeeCalculatorTest` (9 tests)
- `TokensTest` (8 tests)
- `OracleTest` (13 tests)
- `PoolCustodyTest` (15 tests)
- `GovernanceTest` (7 tests)
- `TradingTest` (10 integration tests)
- `P2PTradingTest` (7 integration tests)
- `FullLifecycleTest` (8 integration tests)
- `MarketTransitionTest` (3 integration tests)
- `CustodyDrainTest` (3 integration tests)
- `P2PEscrowDrainTest` (4 integration tests)
- `PoolInvariantTest` (4 invariant tests)
- `TradingInvariantTest` (4 invariant tests)
- `P2PInvariantTest` (3 invariant tests)

**18 Oracle TypeScript tests passing** across 3 test files:
- `fetcher.test.ts` (4 tests)
- `priceStore.test.ts` (7 tests)
- `marketStateDetector.test.ts` (7 tests)

## Critical Bugs Found & Fixed

| Bug | Impact | Fix |
|-----|--------|-----|
| Fee dust in custody | Open fee USDC sent to custody but not tracked in availableBalance — LP withdrawals eventually fail | `custody.receiveFees(openFee)` in Trading.openPosition |
| PnL not reported to pool | pool.totalPoolUSDC didn't change on trader wins/losses — LP share price stale | `pool.absorbPnL(pnlImpact)` in Trading._closePosition |
| P2P escrow over-withdrawal | Profitable trader could withdraw own collateral + entire escrow (including own money) | Cap profit at `escrow - pos.collateral` (other traders' money only) |
| P2P escrow tracker desync | Profitable close only reduced escrow by collateral (not collateral+profit) — escrow > actual USDC — subsequent closers revert | Decrease escrow by `collateral + cappedPnl`; cap payout at contract USDC balance |
| P2P fees stuck in pool contract | P2P fees sent to pool but not forwarded to custodies — waterfall can't find USDC | pool.receiveFees distributes P2P fees to custodies |
| settleP2PBatch missing nonReentrant | Batch settlement lacked reentrancy guard — defense in depth gap | Added nonReentrant modifier |
| VFR never enforced | Funding rate accumulator accrued but never consumed on close — longs never pay shorts when OI is imbalanced | `_calculateAccumulatedFunding()` + wire into `_closePosition` and `liquidate`; signed `int256` snapshot |
| Funding snapshot loses sign | `uint256(abs(cumulativeFundingPerUnit))` lost direction — position always "owed" funding | Store `int256` snapshot directly, compute signed delta on close |
| P2P leftover USDC stuck | After all P2P positions close, rounding dust stays in contract forever | `sweepLeftoverUSDC()` sends residual to pool |

## Slither Findings Summary

| Severity | Count | Details |
|----------|-------|---------|
| High | 0 | — |
| Medium | 1 | abi.encodePacked collision (Oracle) — mitigated by ECDSA signature |
| Low | 4 | Reentrancy (all have nonReentrant), divide-before-multiply (intentional), strict equality |
| Informational | 59 | Missing events, zero-checks, timestamp usage, loop calls, cyclomatic complexity |

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-05 | Use Anvil for localnet | Standard Foundry tooling, CTC is EVM-compatible |
| 2026-03-05 | UUPS proxy pattern | Lower gas, simpler than Transparent Proxy |
| 2026-03-05 | Separate P2PTrading from Trading | Different pricing models, escrow, settlement |
| 2026-03-05 | Cumulative fee accumulators | O(1) per position, GMX-proven pattern |
| 2026-03-05 | Prisma v5 ORM | Stable, auto-generated TS types (v7 had breaking changes) |
| 2026-03-05 | TradingView Lightweight Charts v4 | Stable addCandlestickSeries API, v5 broke compat |
| 2026-03-05 | wagmi + viem + RainbowKit | Standard EVM stack, custom chain support confirmed |
| 2026-03-05 | Platinum instead of Oil | Oil feed ID not found; Platinum (2062) confirmed live |
| 2026-03-05 | via_ir = true | Required for DeployLocal.s.sol stack depth |
| 2026-03-05 | All USDC in custodies | Pool is accounting only. Fees, PnL, deposits all flow to custodies. |
| 2026-03-05 | Signed int256 funding | Funding can be positive (pay) or negative (receive). Plan's abs() would penalize minority side. |
| 2026-03-05 | Pool as funding intermediary | Keeps pool accounting in sync. Net zero when both sides exist. Pool keeps residual when imbalanced (GMX pattern). |
| 2026-03-05 | P2P sweep function | Rounding dust from capped payouts needs explicit cleanup path. |

## Blockers

None.

## Future Work (v2)

- ADL (Auto-Deleveraging) for extreme scenarios
- E2E tests (Playwright) for frontend
- Gas optimization pass (forge snapshot)
- CreditCoin devnet deployment
- Replace MockUSDC with bridged USDC
- Team wallet for protocol fee split
- ~~Oracle service Vitest tests~~ ✅ 18 tests (fetcher, priceStore, marketStateDetector)
- ~~Proposal creation in governance UI~~ ✅ Preset actions + custom calldata
- Frontend tests

## Quick Start

```bash
./start.sh
```

Starts Anvil, deploys all contracts, launches oracle service and frontend.
- Frontend: http://localhost:3000
- Oracle WS: ws://localhost:8080
- Oracle API: http://localhost:3001
- Anvil RPC: http://127.0.0.1:8545

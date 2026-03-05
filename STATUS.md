# CTC-Perps: Build Status

## Current Phase: PLANNING (Complete)

## Progress Tracker

### Phase 1: Foundation
- [ ] Restructure repo into monorepo (contracts/, oracle/, frontend/, database/)
- [ ] Move Foundry files under contracts/
- [ ] Install OpenZeppelin upgradeable contracts
- [ ] FixedPointMath.sol library
- [ ] PriceUtils.sol library
- [ ] MockUSDC.sol
- [ ] CLP.sol (UUPS)
- [ ] CPERP.sol
- [ ] Oracle.sol (UUPS, ECDSA verification, staleness, fresh flag)
- [ ] Unit tests for Phase 1

### Phase 2: Pool & Custody
- [ ] Pool.sol (deposit/withdraw, CLP mint/burn)
- [ ] WaterfallWithdraw.sol library
- [ ] Custody.sol (per-commodity, 4 instances)
- [ ] FeeManager.sol (cumulative accumulators)
- [ ] MarketState.sol (per-feed state machine)
- [ ] Wire Pool -> Custodies
- [ ] Unit tests for Phase 2
- [ ] Integration test: deposit -> fees -> withdraw

### Phase 3: Market-Hours Trading
- [ ] Trading.sol (open, close, liquidate)
- [ ] Wire Trading -> Custody, Oracle, FeeManager
- [ ] PnL calculation with caps
- [ ] Liquidation at 30% maintenance margin
- [ ] 120s min position open time
- [ ] Unit tests for Phase 3
- [ ] Integration test: multi-trader scenarios

### Phase 4: Off-Hours P2P
- [ ] VAMM.sol (x*y=k, multiplier, init/deactivate)
- [ ] P2PTrading.sol (open, close, settle)
- [ ] P2P escrow pools (separate from main)
- [ ] P2P base fee -> main pool
- [ ] P2P funding rate between traders
- [ ] settleP2PBatch for market open
- [ ] Wire MarketState -> VAMM
- [ ] Unit tests for Phase 4
- [ ] Integration test: full off-hours cycle

### Phase 5: Governance
- [ ] Governance.sol (propose, vote, execute)
- [ ] Wire to all admin functions
- [ ] Unit tests for Phase 5

### Phase 6: Oracle Service
- [ ] Initialize TypeScript project
- [ ] PostgreSQL schema (Prisma)
- [ ] Fetcher (Autonom 0.5s polling)
- [ ] PriceStore (OHLCV aggregation)
- [ ] ChainPusher (ECDSA sign + submit)
- [ ] MarketStateDetector (fresh flag)
- [ ] WebSocket server
- [ ] MainKeeper (liquidation every 0.5s)
- [ ] MarketOpenKeeper (batch settlement)
- [ ] KeeperCoordinator (no overlap)
- [ ] REST API for candles
- [ ] Tests

### Phase 7: Frontend
- [ ] Initialize Next.js + Tailwind + wagmi + viem + RainbowKit
- [ ] CreditCoin chain config (defineChain)
- [ ] TradingView Lightweight Charts
- [ ] WebSocket hook for real-time prices
- [ ] Trading panel + order form
- [ ] Position management
- [ ] LP interface (deposit/withdraw/stats)
- [ ] Market status UI + P2P warnings
- [ ] Governance interface
- [ ] Tests

### Phase 8: Integration & Deployment
- [ ] DeployLocal.s.sol script
- [ ] Startup script (Anvil + deploy + PG + oracle + frontend)
- [ ] E2E testing
- [ ] Gas optimization
- [ ] Documentation

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-05 | Use Anvil for localnet | Standard Foundry tooling, CTC is EVM-compatible |
| 2026-03-05 | UUPS proxy pattern | Lower gas, simpler than Transparent Proxy |
| 2026-03-05 | Separate P2PTrading from Trading | Different pricing models, escrow, settlement |
| 2026-03-05 | Cumulative fee accumulators | O(1) per position, GMX-proven pattern |
| 2026-03-05 | Prisma ORM | Mature, auto-generated TS types |
| 2026-03-05 | TradingView Lightweight Charts | Apache 2.0, 45KB, custom data feed support |
| 2026-03-05 | wagmi + viem + RainbowKit | Standard EVM stack, custom chain support confirmed |
| 2026-03-05 | Platinum instead of Oil | Oil feed ID not found; Platinum (2062) confirmed live |

## Blockers

None currently.

## Notes

- All tokens are MOCK for v1 (localnet only)
- When moving to CTC devnet: replace MockUSDC with bridged USDC, update chain config
- Protocol fee currently redirects to custody address (not team wallet)
- ADL (Auto-Deleveraging) deferred to v2

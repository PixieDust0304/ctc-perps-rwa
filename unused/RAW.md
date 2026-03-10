# pErp-man: Raw Design Decisions & Cross-Check

## Chain & Environment

- **Chain**: CreditCoin (EVM-compatible, Substrate-based dual-account)
- **Chain IDs**: Mainnet 102030, Testnet 102031, Local 42
- **RPC**: wss://mainnet3.creditcoin.network (mainnet), http://127.0.0.1:8545 (Anvil local)
- **Native Currency**: CTC (18 decimals)
- **Block Explorer**: https://creditcoin.blockscout.com
- **Block Time**: 15 seconds (mainnet), 2 seconds (Anvil)
- **Target**: Localnet (Anvil) only for v1. No mainnet/devnet.
- **All tokens are MOCK** (MockUSDC, PMLP, PRPMAN)

## Oracle: Autonom

- **URL**: http://178.128.21.71:3000
- **Endpoint**: `/prices/batch?feed_ids=2056,2069,2003,2062`
- **Auth**: Header `x-api-key: readkey1`
- **Response format**:
  ```json
  {
    "prices": [
      {"feed_id": 2056, "price": 3037700000000, "expo": -10, "timestamp": 1772717959520}
    ],
    "signature": "78e4b840...",
    "recovery_id": 0,
    "served_at": 1772717960392,
    "request": {"fresh": true, "prefer_cache": false, "allow_stale_on_error": true, "include_eth": true},
    "kid": "v1-ef6a9659f6e3dab4",
    "version": 2
  }
  ```
- **Price calculation**: `price * 10^expo` (expo = -10), convert to 18 decimals onchain: `price * 10^8`
- **Market hours**: Three-state detection: OPEN (fresh=true confirmed), PAUSED (transitioning), CLOSED (fresh=false confirmed). Schedule-based with debounce confirmations and cooldown. Frozen timestamp detection for stale feeds.
- **Chain pushing**: Cache-based decision — push on price change, heartbeat every 180s, or skip if unchanged
- **Boot sequence**: `initOnChainState()` reads on-chain prices, market state, and custody state before starting pipeline
- **Fetch interval**: 5 seconds (sequential `while(true)` loop)
- **Staleness cap**: 210 seconds — accommodates Autonom's ~120s commodity feed cadence
- **Signer**: Single trusted ECDSA signer, admin (DAO) can change
- **Signature method**: `keccak256(abi.encode(feedIds, rawPrices, timestamps, freshFlags))` — uses `abi.encode` (not `encodePacked`) to prevent hash collisions with dynamic arrays

## Feed IDs

| Asset | Feed ID | Approx Price |
|-------|---------|-------------|
| Gold/XAU | 2056 | ~$5,130 |
| Silver/XAG | 2069 | ~$83 |
| Crude Oil/CL1 | 2003 | ~$79 |
| Platinum/XPT | 2062 | ~$2,148 |

## Markets & Pool Model

- **4 commodity markets**: Gold, Silver, Crude Oil, Platinum
- **Single pool** with 4 **isolated custodies** (one per commodity)
- **Pool vs Traders** during market hours
- **P2P (trader vs trader)** during off-hours
- **Collateral**: USDC only (mock ERC-20, 18 decimals)
- **LP token**: PMLP (linear scaling with total pool USDC)
- **Governance token**: PRPMAN (admin owns 100% initially)

## Trading Parameters (Market Hours)

- **Max leverage**: 100x
- **Min position size**: $10 USD
- **Min position open time**: 300 seconds (anti-MEV/oracle arbitrage)
- **Maintenance margin**: 10% of initial collateral (1000 bps)
  - At 100x leverage: ~0.9% adverse price move = liquidation
  - At 10x leverage: ~9% adverse price move = liquidation
- **Liquidation**: Full liquidation, public call (anyone can execute)
- **Payout cap**: min(sizeUsd, custody_available_balance)
- **Pool utilization**: 100% allowed per custody
- **Fee-then-size model**: Open fee deducted from collateral before computing sizeUsd. `sizeUsd = (collateral - openFee) × leverage`. Trader gets exact requested leverage.

## Trading Parameters (P2P Off-Hours)

- **Max leverage**: 100x
- **Min position size**: $10 USD
- **Min position open time**: 10 seconds (shorter than market hours — VAMM pricing, no oracle arb risk)
- **No liquidations** during off-hours
- **Profit capped** at other traders' collateral (zero-sum escrow)
- **Same fee-then-size model** as market hours

## Custody Economics

### totalTraderCollateral Separation
- **Problem**: When trader collateral is included in `availableBalance`, it artificially inflates LP liquidity, suppressing borrow fee rates. More traders = cheaper fees (perverse incentive). Also creates circular dependency — trader collateral backing other traders' payouts.
- **Solution**: `totalTraderCollateral` counter in Custody. Incremented on `increasePosition()`, decremented on `decreasePosition()`.
- **Fee rate denominator**: `lpLiquidity = availableBalance - totalTraderCollateral` (LP-only liquidity)
- **Reservation checks and payout caps** still use raw `availableBalance` (reflects actual USDC in custody)

## Fee Structure

| Fee | Rate | Interval | Destination |
|-----|------|----------|-------------|
| Open/Close | 0.1% of preliminary notional | One-time | Pool (90% LP / 10% protocol) |
| Base Fee (borrow) | 0-5% per hour | Applied every 15s | Pool (90% LP / 10% protocol) |
| Funding Rate | Small, imbalance-based | Applied every 15s | Between traders (pool as intermediary) |

### Base Fee Formula (Utilization-Based)
- `lpLiquidity = availableBalance - totalTraderCollateral`
- `rate_for_side = (side_OI / lpLiquidity) × maxBaseFee / 240`
- Utilization capped at 100% (rate never exceeds maxBaseFee)
- Both sides ALWAYS pay (cost of borrowing from pool)
- Per-15s rate = hourly_rate / 240
- 90% to PMLP holders (LPs), 10% to protocol

### Funding Rate Formula
- Imbalance-based: majority side pays minority side
- If longs=90%, shorts=10%: longs pay shorts proportional to imbalance
- Applied every 15 seconds
- Small per-interval amount, compounds over time
- Zero-sum between traders. Pool acts as accounting intermediary:
  - Trader pays funding → pool.absorbPnL(+amount) (USDC stays in custody)
  - Trader receives funding → pool.absorbPnL(-amount) (USDC leaves custody)
  - Net pool impact is zero when both sides exist. When imbalanced with no counterparty, pool keeps residual.
- Accumulated funding is signed (int256): positive = trader pays, negative = trader receives
- Longs use cumulative delta as-is; shorts invert the delta
- Formula: `funding_rate = (long_OI - short_OI) / (long_OI + short_OI) × max_funding_rate`

## Off-Hours P2P System

### Trigger
- Autonom returns `fresh=false` for a feed (debounced with configurable confirmations) → off-hours mode
- Per-feed independent (Gold can be closed while Silver is open)

### VAMM Pricing
- Virtual AMM (x*y=k, like Perpetual Protocol v1)
- Initializes at last known spot price when market closes
- Positions move the virtual price (shorts push down, longs push up)
- **Multiplier**: scales to millions for meaningful impact
  - Gold ~$13M virtual depth → $10K trade moves price ~0.08%
  - Configurable per custody via DAO
- At market open: VAMM price discarded, real spot price used for settlement

### P2P Mechanics
- **Completely separate** from main pool (separate P2P escrow pools per commodity)
- **No pool capital at risk** during off-hours
- Traders can open AND close positions during off-hours
- Close during off-hours: PnL settled at VAMM price, paid from opposing side's collateral
- **NO liquidations** during off-hours
- Early closers can drain P2P pool ("first to close wins" dynamic - INTENTIONAL)
- Base fee → main pool (risk-free LP yield)
- 0.1% open/close fee → main pool
- Min open time: 10 seconds (vs 300s for market hours)

### Market Open Settlement
- Oracle service detects `fresh=true` (debounced) → triggers settlement
- **Separate keeper** (P2PSettlementKeeper) handles this
- ALL off-hours positions are **force-closed** at real spot price
- Batch settlement in chunks of 50 positions
- `sweepLeftoverUSDC()` cleans rounding dust
- **Must complete before** main market trading resumes (KeeperCoordinator lock)
- Only handles positions opened during market-close timestamps

### Main Pool Positions During Off-Hours
- Remain open, NOT touched by off-hours settlement
- Continue accruing base fee and funding rate
- No liquidation during off-hours
- At market open: main keeper evaluates against new spot price

## LP Withdrawal Waterfall

- Proportional withdrawal across all custodies
- If withdrawing 20% of PMLP from pool with available [5, 15, 45, 95]:
  1. Try 20 from each custody (80 total / 4 = 20 each)
  2. Custody 1 has 5: drain it completely, shortfall = 15
  3. Custody 2 has 15: drain it completely, shortfall = 5
  4. Total shortfall = 20, redistribute to remaining 2 custodies (10 each)
  5. Custody 3: take 20 + 10 = 30, has 45, remaining = 15
  6. Custody 4: take 20 + 10 = 30, has 95, remaining = 65
  7. Result: [0, 0, 15, 65]
- If even remaining custodies can't cover: fail the withdrawal

## DAO Governance

- **Token**: PRPMAN (ERC-20, 100% to admin initially)
- **Quorum**: 20% of total supply
- **Majority**: 51%
- **Voting period**: 48 hours
- **Timelock**: None - immediate execution on passing
- **Scope**: Everything admin-configurable

## Tokens

| Token | Type | Purpose |
|-------|------|---------|
| MockUSDC | ERC-20, 18 decimals | Collateral for all trading |
| PMLP | ERC-20, UUPS upgradeable | LP receipt, linear with pool USDC, tradeable |
| PRPMAN | ERC-20 | Governance, tradeable, DAO voting power |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contracts | Solidity, Foundry, OpenZeppelin UUPS |
| Oracle Service | TypeScript, Node.js, viem |
| Keepers | TypeScript (same service as oracle, tick-based) |
| Database | PostgreSQL, Prisma ORM v5 |
| Frontend | Next.js 16, React 19, wagmi, viem, RainbowKit |
| Charts | TradingView Lightweight Charts v4 |
| Real-time | WebSocket (oracle → frontend) |
| Local Chain | Anvil (Foundry) |

## Cross-Check: Issues Found & Resolutions

### Issue 1: Min Open Time in Off-Hours
- 300s was designed to prevent oracle arbitrage during market hours
- Off-hours uses VAMM (not oracle), so oracle arb doesn't apply
- BUT someone could open/close quickly to extract from opposing side
- **RESOLUTION**: Apply 10s min open time to P2P (shorter since no oracle arb, but prevents instant extraction)

### Issue 2: Oracle Staleness + Off-Hours
- 210s staleness cap would trigger during off-hours (stale prices)
- **RESOLUTION**: Staleness only enforced during market hours. Off-hours P2P uses VAMM, doesn't depend on oracle freshness.

### Issue 3: Off-Hours No Liquidation + Negative Equity
- No liquidation during off-hours means positions can go deeply underwater
- **RESOLUTION**: P2P payouts capped at available P2P pool collateral. Negative equity positions contribute 0 at settlement.

### Issue 4: Base Fee - Both Sides Pay
- Formula: `(side_OI / lpLiquidity) × maxBaseFee` means BOTH sides always pay
- **RESOLUTION**: Intentional design - cost of borrowing from pool. NOT a contradiction.

### Issue 5: 100% Utilization + Payout
- If all traders win, pool can't pay everyone
- **RESOLUTION**: Payout capped at min(sizeUsd, custody_available_balance). First to close gets paid. Consider ADL for v2.

### Issue 6: PMLP Value + Custody Isolation
- PMLP scales with total pool USDC, but custodies are isolated
- If Gold custody gets drained, PMLP value drops
- **RESOLUTION**: Intentional - LPs accept aggregate risk. Custodies isolated for TRADER risk management.

### Issue 7: Trader Collateral Inflating LP Metrics
- Trader USDC deposits increase `availableBalance`, making utilization appear lower, suppressing borrow fees
- More traders = cheaper fees (perverse incentive)
- **RESOLUTION**: `totalTraderCollateral` tracked separately. Fee rate uses `lpLiquidity = availableBalance - totalTraderCollateral`. Reservation checks and payout caps still use raw `availableBalance`.

### Issue 8: abi.encodePacked Hash Collisions
- `abi.encodePacked` with dynamic arrays can produce identical hashes for different inputs
- **RESOLUTION**: Changed Oracle.sol signature to use `abi.encode`. Oracle signing.ts uses `encodeAbiParameters` to match.

### Issue 9: Fee-Then-Size vs Size-Then-Fee
- Original: `sizeUsd = collateral × leverage`, fee deducted after. Trader gets slightly higher effective leverage than requested.
- **RESOLUTION**: Fee-then-size model. `prelimSize = collateral × leverage`, `openFee = prelimSize × feeBps`, `sizeUsd = (collateral - openFee) × leverage`. Exact requested leverage, no silent bump.

### Issue 10: 30% Maintenance Margin Too Aggressive
- At 100x leverage with 30% maintenance margin, liquidation at 0.7% adverse move
- Industry standards: 0.5-5% maintenance margin for high-leverage perps
- **RESOLUTION**: Reduced to 10% (1000 bps). At 100x: ~0.9% adverse move. At 10x: ~9% adverse move. Reasonable for commodity markets.

### Issue 11: VAMM k-value Initialization
- Need initial virtual reserve amounts, not just spot price
- **RESOLUTION**: Multiplier config defines virtual depth. Gold at $5130/oz, virtual depth $13M: `x_virtual = depth / price`, `y_virtual = depth`, `k = x * y`.

### Issue 12: P2P Settlement Gas Costs
- Force-closing hundreds of positions could be expensive
- **RESOLUTION**: Batch settlement `settleP2PBatch(bytes32[])` in chunks of 50. Keeper processes iteratively.

### Issue 13: CreditCoin Compatibility (CONFIRMED)
- wagmi + viem: COMPATIBLE via `defineChain`
- RainbowKit: COMPATIBLE via custom chain config
- TradingView Lightweight Charts: COMPATIBLE (pure frontend, no chain dependency)
- Foundry/Anvil: COMPATIBLE (standard EVM)
- MetaMask: COMPATIBLE (standard EVM chain)

### Issue 14: DB-Chain Desync
- Events can be missed if oracle service crashes during position open/close
- **RESOLUTION**: PositionReconciler runs every `max(blockTimeMs×4, 10s)`, verifies all DB "open" positions against on-chain state. Catches missed events.

## Git Config
- **User**: Supreeta Dubey
- **Email**: supreeta.inficorp@gmail.com

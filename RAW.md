# CTC-Perps: Raw Design Decisions & Cross-Check

## Chain & Environment

- **Chain**: CreditCoin (EVM-compatible, Substrate-based dual-account)
- **Chain IDs**: Mainnet 102030, Testnet 102031, Local 42
- **RPC**: wss://mainnet3.creditcoin.network (mainnet), http://127.0.0.1:8545 (Anvil local)
- **Native Currency**: CTC (18 decimals)
- **Block Explorer**: https://creditcoin.blockscout.com
- **Block Time**: 15 seconds
- **Target**: Localnet (Anvil) only for v1. No mainnet/devnet.
- **All tokens are MOCK** (MockUSDC, CLP, CPERP)

## Oracle: Autonom

- **URL**: http://178.128.21.71:3000
- **Endpoint**: `/prices/batch?feed_ids=2056,2069,2015,2062`
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
- **Market hours**: `fresh=true` = market open, `fresh=false` = market closed
- **Fetch interval**: 0.5 seconds
- **Staleness cap**: 10 seconds during market hours; protocol pauses if oracle goes down
- **Signer**: Single trusted ECDSA signer, admin (DAO) can change

## Feed IDs

| Asset | Feed ID | Approx Price |
|-------|---------|-------------|
| Gold/XAU | 2056 | ~$3,037 |
| Silver/XAG | 2069 | ~$83 |
| Copper/HG1 | 2015 | ~$2.95 |
| Platinum/XPT | 2062 | ~$2,277 |

## Markets & Pool Model

- **4 commodity markets**: Gold, Silver, Copper, Platinum
- **Single pool** with 4 **isolated custodies** (one per commodity)
- **Pool vs Traders** during market hours
- **P2P (trader vs trader)** during off-hours
- **Collateral**: USDC only (mock ERC-20, 18 decimals)
- **LP token**: CLP (linear scaling with total pool USDC)
- **Governance token**: CPERP (admin owns 100% initially)

## Trading Parameters (Market Hours)

- **Max leverage**: 100x
- **Min position size**: $10 USD
- **Min position open time**: 120 seconds (anti-MEV/oracle arbitrage)
- **Maintenance margin**: 30% of initial collateral
  - At 100x leverage: 0.7% adverse price move = liquidation
  - At 10x leverage: 7% adverse price move = liquidation
- **Liquidation**: Full liquidation, public call (anyone can execute)
- **Short payout cap**: collateral x leverage
- **Long payout cap**: min(collateral x leverage, custody_available_balance)
- **Pool utilization**: 100% allowed per custody

## Fee Structure

| Fee | Rate | Interval | Destination |
|-----|------|----------|-------------|
| Open/Close | 0.1% of notional | One-time | Pool (90% LP / 10% protocol) |
| Base Fee (borrow) | 0-5% per hour | Applied every 15s | Pool (90% LP / 10% protocol) |
| Funding Rate | Small, imbalance-based | Applied every 15s | Between traders |

### Base Fee Formula
- `rate_for_side = (side_OI / total_OI) x 5% per hour`
- Example: 20% longs, 80% shorts -> longs pay 1%/hr, shorts pay 4%/hr
- Both sides ALWAYS pay (cost of borrowing from pool)
- Per-15s rate = hourly_rate / 240
- 90% to CLP holders (LPs), 10% to protocol
- Protocol fee initially redirected to custody address (not team wallet)

### Funding Rate Formula
- Imbalance-based: majority side pays minority side
- If longs=90%, shorts=10%: "longs pay for the missing 40% on the short side" (40% = gap from 50/50)
- Applied every 15 seconds (per block)
- Small per-interval amount, compounds over time
- Goes between traders (NOT to pool)
- Proposed: `funding_rate = (long_OI - short_OI) / (long_OI + short_OI) x max_funding_rate`

## Off-Hours P2P System

### Trigger
- Autonom returns `fresh=false` for a feed -> that commodity enters off-hours mode
- Per-feed independent (Gold can be closed while Silver is open)

### VAMM Pricing
- Virtual AMM (x*y=k, like Perpetual Protocol v1)
- Initializes at last known spot price when market closes
- Positions move the virtual price (shorts push down, longs push up)
- **Multiplier**: scales trillion-dollar commodity markets to millions for meaningful impact
  - Gold ~$13T market -> ~$13M virtual depth -> $10K trade moves price ~0.08%
  - Configurable per custody via DAO
- At market open: VAMM price discarded, real spot price used for settlement

### P2P Mechanics
- **Completely separate** from main pool (separate P2P escrow pools per commodity)
- **No pool capital at risk** during off-hours
- Traders can open AND close positions during off-hours
- Close during off-hours: PnL settled at VAMM price, paid from opposing side's collateral
- **NO liquidations** during off-hours
- Early closers can drain P2P pool ("first to close wins" dynamic - INTENTIONAL)
- **One-sided trades**: Pay 5% max base fee, routed to MAIN pool (risk-free LP yield)
- **Two-sided trades**: Funding rate between P2P traders, base fee to main pool
- 0.1% open/close fee -> main pool

### Market Open Settlement
- Oracle service detects `fresh=true` -> triggers settlement sub-service
- **Separate keeper** (Market-Open Keeper) handles this
- ALL off-hours positions are **force-closed** at real spot price
- Winning side splits losing side's collateral **pro-rata** by position size
- If no opposing side: payout = 0
- If negative equity: capped at 0 (no bad debt)
- **Multiple retries** until 100% settled
- **Must complete before** main market trading resumes (no overlap)
- Only handles positions opened during market-close timestamps

### Main Pool Positions During Off-Hours
- Remain open, NOT touched by off-hours settlement
- Continue accruing base fee and funding rate
- No liquidation during off-hours
- At market open: main keeper evaluates against new spot price
- Example: short at $100, liq at $105, market opens at $106 -> liquidated by main keeper

## LP Withdrawal Waterfall

- Proportional withdrawal across all custodies
- If withdrawing 20% of CLP from pool with available [5, 15, 45, 95]:
  1. Try 20 from each custody (80 total / 4 = 20 each)
  2. Custody 1 has 5: drain it completely, shortfall = 15
  3. Custody 2 has 15: drain it completely, shortfall = 5
  4. Total shortfall = 20, redistribute to remaining 2 custodies (10 each)
  5. Custody 3: take 20 + 10 = 30, has 45, remaining = 15
  6. Custody 4: take 20 + 10 = 30, has 95, remaining = 65
  7. Result: [0, 0, 15, 65]
- If even remaining custodies can't cover: fail the withdrawal

## DAO Governance

- **Token**: CPERP (ERC-20, 100% to admin initially)
- **Quorum**: 20% of total supply
- **Majority**: 51%
- **Voting period**: 48 hours
- **Timelock**: None - immediate execution on passing
- **Scope**: Everything admin-configurable (custody allocations, fee params, VAMM depth, oracle signer, max leverage, new markets, emergency pause, etc.)

## Tokens

| Token | Type | Purpose |
|-------|------|---------|
| MockUSDC | ERC-20, 18 decimals | Collateral for all trading |
| CLP | ERC-20, UUPS upgradeable | LP receipt, linear with pool USDC, tradeable |
| CPERP | ERC-20 | Governance, tradeable, DAO voting power |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contracts | Solidity, Foundry, OpenZeppelin UUPS |
| Oracle Service | TypeScript, Node.js, viem |
| Liquidation Bot | TypeScript (same service as oracle) |
| Database | PostgreSQL, Prisma ORM |
| Frontend | Next.js, wagmi, viem, RainbowKit |
| Charts | TradingView Lightweight Charts (Apache 2.0) |
| Real-time | WebSocket (oracle -> frontend) |
| Local Chain | Anvil (Foundry) |

## Cross-Check: Issues Found & Resolutions

### Issue 1: 120s Min Open Time in Off-Hours
- 120s was designed to prevent oracle arbitrage during market hours
- Off-hours uses VAMM (not oracle), so oracle arb doesn't apply
- BUT someone could open/close quickly to extract from opposing side
- **RESOLUTION**: Apply 120s to off-hours too for consistency

### Issue 2: Oracle Staleness + Off-Hours
- 10s staleness cap would trigger during off-hours (stale prices)
- **RESOLUTION**: Staleness only enforced during market hours. Off-hours P2P uses VAMM, doesn't depend on oracle freshness.

### Issue 3: Off-Hours No Liquidation + Negative Equity
- No liquidation during off-hours means positions can go deeply underwater
- **RESOLUTION**: P2P payouts capped at available P2P pool collateral. Negative equity positions contribute 0 at settlement.

### Issue 4: Base Fee - Both Sides Pay
- Formula: `(side_OI / total_OI) x 5%` means BOTH sides always pay
- Different from Gains Network (only majority pays)
- **RESOLUTION**: Intentional design - cost of borrowing from pool. NOT a contradiction.

### Issue 5: 100% Utilization + Long Payout
- If all traders win, pool can't pay everyone
- **RESOLUTION**: Long payout capped at min(collateral x leverage, custody_available_balance). First to close gets paid. Consider ADL (Auto-Deleveraging) for v2.

### Issue 6: CLP Value + Custody Isolation
- CLP scales with total pool USDC, but custodies are isolated
- If Gold custody gets drained, CLP value drops
- **RESOLUTION**: Intentional - LPs accept aggregate risk. Custodies isolated for TRADER risk management.

### Issue 7: Off-Hours Base Fee Destination
- Fee rate based on P2P OI skew (not pool utilization)
- Fee destination is main pool
- **RESOLUTION**: Consistent - different rate calculation vs destination. Risk-free yield for LPs.

### Issue 8: Market Open Settlement Order
- Off-hours keeper MUST complete before main keeper resumes
- Could delay main market trading
- **RESOLUTION**: Acceptable trade-off for correctness. Batch settlement with retries.

### Issue 9: VAMM Price vs Spot Disconnect
- Off-hours closes settle at VAMM price, market-open settles at real spot
- **RESOLUTION**: Intentional "gambling" aspect. Not a bug.

### Issue 10: 100x Leverage + 0.1% Fee Impact
- At 100x: 0.1% open fee = 10% of collateral. Open + close = ~20% of collateral.
- **RESOLUTION**: Intentional economic disincentive against extreme leverage. Display warning in UI.

### Issue 11: VAMM k-value Initialization
- Need initial virtual reserve amounts, not just spot price
- **RESOLUTION**: Multiplier config defines virtual depth. Gold at $3000/oz, virtual depth $13M: `x_virtual = depth / price`, `y_virtual = depth`, `k = x * y`.

### Issue 12: P2P Settlement Gas Costs
- Force-closing hundreds of positions could be expensive
- **RESOLUTION**: Batch settlement function `settleP2PBatch(uint256[] positionIds)`. Keeper processes in chunks.

### Issue 13: CreditCoin Compatibility (CONFIRMED)
- wagmi + viem: COMPATIBLE via `defineChain`
- RainbowKit: COMPATIBLE via custom chain config
- TradingView Lightweight Charts: COMPATIBLE (pure frontend, no chain dependency)
- Foundry/Anvil: COMPATIBLE (standard EVM)
- MetaMask: COMPATIBLE (standard EVM chain)

## Git Config
- **User**: Supreeta Dubey
- **Email**: supreeta.inficorp@gmail.com

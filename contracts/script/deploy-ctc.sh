#!/usr/bin/env bash
set -euo pipefail

# pErp-man CTC Testnet Deployment Script
# Uses forge create + cast send (bypasses forge script prevrandao issue)
#
# Prerequisites:
#   - .env file at project root with DEPLOYER_PRIVATE_KEY and ORACLE_SIGNER (private key)
#   - Deployer wallet funded with CTC for gas
#   - Contracts compiled (forge build)

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
cd "$CONTRACTS_DIR"

# Load env
if [ -f "$ROOT_DIR/.env" ]; then
  source "$ROOT_DIR/.env"
fi

if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  echo "ERROR: DEPLOYER_PRIVATE_KEY not set. Add it to .env"
  exit 1
fi
if [ -z "${ORACLE_SIGNER:-}" ]; then
  echo "ERROR: ORACLE_SIGNER not set. Add it to .env"
  exit 1
fi

RPC_URL="${RPC_URL:-https://rpc.cc3-testnet.creditcoin.network}"
FORGE="${FORGE:-$HOME/.foundry/bin/forge}"
CAST="${CAST:-$HOME/.foundry/bin/cast}"
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1

DEPLOYER=$($CAST wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
SIGNER_ADDRESS=$($CAST wallet address --private-key "$ORACLE_SIGNER")
PK="$DEPLOYER_PRIVATE_KEY"

echo "========================================="
echo "  pErp-man CTC Testnet Deployment"
echo "========================================="
echo "  RPC:       $RPC_URL"
echo "  Deployer:  $DEPLOYER"
echo "  Signer:    $SIGNER_ADDRESS"
echo "========================================="
echo ""

COMMON="--rpc-url $RPC_URL --private-key $PK --legacy"
# CTC gas estimation is unreliable — use block gas limit (75M) as failsafe.
# Unused gas is not charged; only actual consumption counts.
SEND_COMMON="--rpc-url $RPC_URL --private-key $PK --legacy --gas-limit 75000000"

log() { echo "[$(date +%H:%M:%S)] $1"; }

# Extract deployed address from forge create text output ("Deployed to: 0x...")
extract_address() {
  echo "$1" | grep "Deployed to:" | awk '{print $NF}'
}

# ─── 1. Deploy Tokens ────────────────────────────────────────────

log "Deploying MockUSDC..."
USDC_OUT=$($FORGE create src/tokens/MockUSDC.sol:MockUSDC $COMMON --broadcast 2>&1)
USDC=$(extract_address "$USDC_OUT")
log "  MockUSDC: $USDC"

log "Deploying PRPMAN..."
PRPMAN_OUT=$($FORGE create src/tokens/PRPMAN.sol:PRPMAN $COMMON --broadcast --constructor-args "$DEPLOYER" 2>&1)
PRPMAN=$(extract_address "$PRPMAN_OUT")
log "  PRPMAN: $PRPMAN"

log "Deploying PMLP (impl + proxy)..."
PMLP_IMPL_OUT=$($FORGE create src/tokens/PMLP.sol:PMLP $COMMON --broadcast 2>&1)
PMLP_IMPL=$(extract_address "$PMLP_IMPL_OUT")
log "  PMLP impl: $PMLP_IMPL"

PMLP_INIT=$($CAST calldata "initialize(address)" "$DEPLOYER")
PMLP_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$PMLP_IMPL" "$PMLP_INIT" 2>&1)
PMLP=$(extract_address "$PMLP_PROXY_OUT")
log "  PMLP proxy: $PMLP"

# ─── 2. Deploy Oracle ────────────────────────────────────────────

log "Deploying Oracle (impl + proxy)..."
ORACLE_IMPL_OUT=$($FORGE create src/core/Oracle.sol:Oracle $COMMON --broadcast 2>&1)
ORACLE_IMPL=$(extract_address "$ORACLE_IMPL_OUT")
log "  Oracle impl: $ORACLE_IMPL"

# encode feedIds array: [2056, 2069, 2003, 2062]
ORACLE_INIT=$($CAST calldata "initialize(address,address,uint256,uint16[])" "$DEPLOYER" "$SIGNER_ADDRESS" 210 "[2056,2069,2003,2062]")
ORACLE_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$ORACLE_IMPL" "$ORACLE_INIT" 2>&1)
ORACLE=$(extract_address "$ORACLE_PROXY_OUT")
log "  Oracle proxy: $ORACLE"

# ─── 3. Deploy Pool ──────────────────────────────────────────────

log "Deploying Pool (impl + proxy)..."
POOL_IMPL_OUT=$($FORGE create src/core/Pool.sol:Pool $COMMON --broadcast 2>&1)
POOL_IMPL=$(extract_address "$POOL_IMPL_OUT")
log "  Pool impl: $POOL_IMPL"

# initialize(owner, usdc, pmlp, feeRecipient, lpShareBps=9000)
POOL_INIT=$($CAST calldata "initialize(address,address,address,address,uint256)" "$DEPLOYER" "$USDC" "$PMLP" "$DEPLOYER" 9000)
POOL_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$POOL_IMPL" "$POOL_INIT" 2>&1)
POOL=$(extract_address "$POOL_PROXY_OUT")
log "  Pool proxy: $POOL"

# Transfer PMLP ownership to Pool
log "  Transferring PMLP ownership to Pool..."
$CAST send "$PMLP" "transferOwnership(address)" "$POOL" $SEND_COMMON > /dev/null

# ─── 4. Deploy FeeManager ────────────────────────────────────────

log "Deploying FeeManager (impl + proxy)..."
FM_IMPL_OUT=$($FORGE create src/core/FeeManager.sol:FeeManager $COMMON --broadcast 2>&1)
FM_IMPL=$(extract_address "$FM_IMPL_OUT")
log "  FeeManager impl: $FM_IMPL"

# initialize(owner, openFeeBps=10, closeFeeBps=5, maxBaseFeePerHourBps=5, lpShareBps=9000, maxFundingRatePerHourBps=10)
FM_INIT=$($CAST calldata "initialize(address,uint256,uint256,uint256,uint256,uint256)" "$DEPLOYER" 10 5 5 9000 10)
FM_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$FM_IMPL" "$FM_INIT" 2>&1)
FEE_MANAGER=$(extract_address "$FM_PROXY_OUT")
log "  FeeManager proxy: $FEE_MANAGER"

# ─── 5. Deploy MarketState ───────────────────────────────────────

log "Deploying MarketState (impl + proxy)..."
MS_IMPL_OUT=$($FORGE create src/core/MarketState.sol:MarketState $COMMON --broadcast 2>&1)
MS_IMPL=$(extract_address "$MS_IMPL_OUT")
log "  MarketState impl: $MS_IMPL"

MS_INIT=$($CAST calldata "initialize(address,address)" "$DEPLOYER" "$ORACLE")
MS_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$MS_IMPL" "$MS_INIT" 2>&1)
MARKET_STATE=$(extract_address "$MS_PROXY_OUT")
log "  MarketState proxy: $MARKET_STATE"

log "  Registering feeds on MarketState..."
$CAST send "$MARKET_STATE" "registerFeed(uint16)" 2056 $SEND_COMMON > /dev/null
$CAST send "$MARKET_STATE" "registerFeed(uint16)" 2069 $SEND_COMMON > /dev/null
$CAST send "$MARKET_STATE" "registerFeed(uint16)" 2003 $SEND_COMMON > /dev/null
$CAST send "$MARKET_STATE" "registerFeed(uint16)" 2062 $SEND_COMMON > /dev/null

# ─── 6. Deploy Custodies ─────────────────────────────────────────

deploy_custody() {
  local name=$1 feed_id=$2
  echo "[$(date +%H:%M:%S)] Deploying Custody $name (impl + proxy)..." >&2
  local impl_out=$($FORGE create src/core/Custody.sol:Custody $COMMON --broadcast 2>&1)
  local impl=$(extract_address "$impl_out")
  local init=$($CAST calldata "initialize(address,uint16,address,address,uint256,uint256)" "$DEPLOYER" "$feed_id" "$USDC" "$POOL" 5 5)
  local proxy_out=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$impl" "$init" 2>&1)
  local proxy=$(extract_address "$proxy_out")
  echo "[$(date +%H:%M:%S)]   Custody $name: $proxy" >&2
  echo "$proxy"
}

CUSTODY_GOLD=$(deploy_custody "Gold" 2056)
CUSTODY_SILVER=$(deploy_custody "Silver" 2069)
CUSTODY_CRUDE_OIL=$(deploy_custody "CrudeOil" 2003)
CUSTODY_PLATINUM=$(deploy_custody "Platinum" 2062)

log "Adding custodies to Pool..."
$CAST send "$POOL" "addCustody(address,uint256)" "$CUSTODY_GOLD" 2500 $SEND_COMMON > /dev/null
$CAST send "$POOL" "addCustody(address,uint256)" "$CUSTODY_SILVER" 2500 $SEND_COMMON > /dev/null
$CAST send "$POOL" "addCustody(address,uint256)" "$CUSTODY_CRUDE_OIL" 2500 $SEND_COMMON > /dev/null
$CAST send "$POOL" "addCustody(address,uint256)" "$CUSTODY_PLATINUM" 2500 $SEND_COMMON > /dev/null

# ─── 7. Deploy Trading ───────────────────────────────────────────

log "Deploying Trading (impl + proxy)..."
TRADING_IMPL_OUT=$($FORGE create src/core/Trading.sol:Trading $COMMON --broadcast 2>&1)
TRADING_IMPL=$(extract_address "$TRADING_IMPL_OUT")
log "  Trading impl: $TRADING_IMPL"

# initialize(owner, usdc, oracle, pool, feeManager, marketState, maxLeverage=100e18, maintenanceMarginBps=1000, minPositionUsd=10e18, minOpenTimeSec=300)
MAX_LEVERAGE=$($CAST --to-wei 100)
MIN_POSITION=$($CAST --to-wei 10)
TRADING_INIT=$($CAST calldata "initialize(address,address,address,address,address,address,uint256,uint256,uint256,uint256)" "$DEPLOYER" "$USDC" "$ORACLE" "$POOL" "$FEE_MANAGER" "$MARKET_STATE" "$MAX_LEVERAGE" 1000 "$MIN_POSITION" 300)
TRADING_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$TRADING_IMPL" "$TRADING_INIT" 2>&1)
TRADING=$(extract_address "$TRADING_PROXY_OUT")
log "  Trading proxy: $TRADING"

log "  Setting feed custodies on Trading..."
$CAST send "$TRADING" "setFeedCustody(uint16,address)" 2056 "$CUSTODY_GOLD" $SEND_COMMON > /dev/null
$CAST send "$TRADING" "setFeedCustody(uint16,address)" 2069 "$CUSTODY_SILVER" $SEND_COMMON > /dev/null
$CAST send "$TRADING" "setFeedCustody(uint16,address)" 2003 "$CUSTODY_CRUDE_OIL" $SEND_COMMON > /dev/null
$CAST send "$TRADING" "setFeedCustody(uint16,address)" 2062 "$CUSTODY_PLATINUM" $SEND_COMMON > /dev/null

log "  Linking Trading to Pool and Custodies..."
$CAST send "$POOL" "setTrading(address)" "$TRADING" $SEND_COMMON > /dev/null
$CAST send "$CUSTODY_GOLD" "setTrading(address)" "$TRADING" $SEND_COMMON > /dev/null
$CAST send "$CUSTODY_SILVER" "setTrading(address)" "$TRADING" $SEND_COMMON > /dev/null
$CAST send "$CUSTODY_CRUDE_OIL" "setTrading(address)" "$TRADING" $SEND_COMMON > /dev/null
$CAST send "$CUSTODY_PLATINUM" "setTrading(address)" "$TRADING" $SEND_COMMON > /dev/null

# ─── 8. Deploy VAMM ──────────────────────────────────────────────

log "Deploying VAMM (impl + proxy)..."
VAMM_IMPL_OUT=$($FORGE create src/core/VAMM.sol:VAMM $COMMON --broadcast 2>&1)
VAMM_IMPL=$(extract_address "$VAMM_IMPL_OUT")
log "  VAMM impl: $VAMM_IMPL"

VAMM_INIT=$($CAST calldata "initialize(address)" "$DEPLOYER")
VAMM_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$VAMM_IMPL" "$VAMM_INIT" 2>&1)
VAMM=$(extract_address "$VAMM_PROXY_OUT")
log "  VAMM proxy: $VAMM"

log "  Configuring VAMM..."
DEPTH_500K=$($CAST --to-wei 500000)
$CAST send "$VAMM" "setDepthMultiplier(uint16,uint256)" 2056 "$DEPTH_500K" $SEND_COMMON > /dev/null
$CAST send "$VAMM" "setDepthMultiplier(uint16,uint256)" 2069 "$DEPTH_500K" $SEND_COMMON > /dev/null
$CAST send "$VAMM" "setDepthMultiplier(uint16,uint256)" 2003 "$DEPTH_500K" $SEND_COMMON > /dev/null
$CAST send "$VAMM" "setDepthMultiplier(uint16,uint256)" 2062 "$DEPTH_500K" $SEND_COMMON > /dev/null
$CAST send "$VAMM" "setMarketState(address)" "$MARKET_STATE" $SEND_COMMON > /dev/null
$CAST send "$VAMM" "setKeeper(address)" "$SIGNER_ADDRESS" $SEND_COMMON > /dev/null

# Initialize VAMMs with approximate spot prices
GOLD_PRICE=$($CAST --to-wei 5080)
SILVER_PRICE=$($CAST --to-wei 82)
OIL_PRICE=$($CAST --to-wei 79)
PLAT_PRICE=$($CAST --to-wei 2126)
$CAST send "$VAMM" "initializeVAMM(uint16,uint256)" 2056 "$GOLD_PRICE" $SEND_COMMON > /dev/null
$CAST send "$VAMM" "initializeVAMM(uint16,uint256)" 2069 "$SILVER_PRICE" $SEND_COMMON > /dev/null
$CAST send "$VAMM" "initializeVAMM(uint16,uint256)" 2003 "$OIL_PRICE" $SEND_COMMON > /dev/null
$CAST send "$VAMM" "initializeVAMM(uint16,uint256)" 2062 "$PLAT_PRICE" $SEND_COMMON > /dev/null

# ─── 9. Deploy P2PTrading ────────────────────────────────────────

log "Deploying P2PTrading (impl + proxy)..."
P2P_IMPL_OUT=$($FORGE create src/core/P2PTrading.sol:P2PTrading $COMMON --broadcast 2>&1)
P2P_IMPL=$(extract_address "$P2P_IMPL_OUT")
log "  P2PTrading impl: $P2P_IMPL"

# initialize(owner, usdc, vamm, pool, marketState, feeManager, minPositionUsd=10e18, minOpenTimeSec=10)
P2P_INIT=$($CAST calldata "initialize(address,address,address,address,address,address,uint256,uint256)" "$DEPLOYER" "$USDC" "$VAMM" "$POOL" "$MARKET_STATE" "$FEE_MANAGER" "$MIN_POSITION" 10)
P2P_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$P2P_IMPL" "$P2P_INIT" 2>&1)
P2P_TRADING=$(extract_address "$P2P_PROXY_OUT")
log "  P2PTrading proxy: $P2P_TRADING"

log "  Linking P2PTrading..."
$CAST send "$VAMM" "setP2PTrading(address)" "$P2P_TRADING" $SEND_COMMON > /dev/null
$CAST send "$POOL" "setP2PTrading(address)" "$P2P_TRADING" $SEND_COMMON > /dev/null
$CAST send "$P2P_TRADING" "setSettlementKeeper(address)" "$SIGNER_ADDRESS" $SEND_COMMON > /dev/null
$CAST send "$CUSTODY_GOLD" "setP2PTrading(address)" "$P2P_TRADING" $SEND_COMMON > /dev/null
$CAST send "$CUSTODY_SILVER" "setP2PTrading(address)" "$P2P_TRADING" $SEND_COMMON > /dev/null
$CAST send "$CUSTODY_CRUDE_OIL" "setP2PTrading(address)" "$P2P_TRADING" $SEND_COMMON > /dev/null
$CAST send "$CUSTODY_PLATINUM" "setP2PTrading(address)" "$P2P_TRADING" $SEND_COMMON > /dev/null

# ─── 10. Deploy Governance ───────────────────────────────────────

log "Deploying Governance (impl + proxy)..."
GOV_IMPL_OUT=$($FORGE create src/governance/Governance.sol:Governance $COMMON --broadcast 2>&1)
GOV_IMPL=$(extract_address "$GOV_IMPL_OUT")
log "  Governance impl: $GOV_IMPL"

# initialize(owner, prpman, quorumBps=2000, passThresholdBps=5100, votingDuration=48hours=172800)
GOV_INIT=$($CAST calldata "initialize(address,address,uint256,uint256,uint256)" "$DEPLOYER" "$PRPMAN" 2000 5100 172800)
GOV_PROXY_OUT=$($FORGE create ../lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy $COMMON --broadcast --constructor-args "$GOV_IMPL" "$GOV_INIT" 2>&1)
GOVERNANCE=$(extract_address "$GOV_PROXY_OUT")
log "  Governance proxy: $GOVERNANCE"

# ─── 11. Mint test USDC & bootstrap liquidity ────────────────────

log "Minting 10M MockUSDC to deployer..."
MINT_AMOUNT=$($CAST --to-wei 10000000)
$CAST send "$USDC" "mint(address,uint256)" "$DEPLOYER" "$MINT_AMOUNT" $SEND_COMMON > /dev/null

log "Bootstrapping Pool with 2M USDC..."
POOL_DEPOSIT=$($CAST --to-wei 2000000)
$CAST send "$USDC" "approve(address,uint256)" "$POOL" "$POOL_DEPOSIT" $SEND_COMMON > /dev/null
$CAST send "$POOL" "deposit(uint256)" "$POOL_DEPOSIT" $SEND_COMMON > /dev/null

# ─── 12. Transfer ownership to Governance ─────────────────────────

log "Transferring ownership to Governance..."
for addr in "$ORACLE" "$POOL" "$TRADING" "$P2P_TRADING" "$VAMM" "$FEE_MANAGER" "$MARKET_STATE" "$CUSTODY_GOLD" "$CUSTODY_SILVER" "$CUSTODY_CRUDE_OIL" "$CUSTODY_PLATINUM"; do
  $CAST send "$addr" "transferOwnership(address)" "$GOVERNANCE" $SEND_COMMON > /dev/null
done
log "All ownership transferred to Governance."

# ─── 13. Save addresses ──────────────────────────────────────────

ADDR_FILE="$ROOT_DIR/.addresses-ctc.json"
cat > "$ADDR_FILE" << EOF
{
  "network": "creditcoin-testnet",
  "chainId": 102031,
  "deployer": "$DEPLOYER",
  "oracleSigner": "$SIGNER_ADDRESS",
  "mockUSDC": "$USDC",
  "pmlp": "$PMLP",
  "prpman": "$PRPMAN",
  "oracle": "$ORACLE",
  "pool": "$POOL",
  "feeManager": "$FEE_MANAGER",
  "marketState": "$MARKET_STATE",
  "trading": "$TRADING",
  "vamm": "$VAMM",
  "p2pTrading": "$P2P_TRADING",
  "governance": "$GOVERNANCE",
  "custodyGold": "$CUSTODY_GOLD",
  "custodySilver": "$CUSTODY_SILVER",
  "custodyCrudeOil": "$CUSTODY_CRUDE_OIL",
  "custodyPlatinum": "$CUSTODY_PLATINUM"
}
EOF

echo ""
echo "========================================="
echo "  Deployment Complete!"
echo "========================================="
echo "  MockUSDC:         $USDC"
echo "  PMLP:             $PMLP"
echo "  PRPMAN:           $PRPMAN"
echo "  Oracle:           $ORACLE"
echo "  Pool:             $POOL"
echo "  FeeManager:       $FEE_MANAGER"
echo "  MarketState:      $MARKET_STATE"
echo "  Trading:          $TRADING"
echo "  VAMM:             $VAMM"
echo "  P2PTrading:       $P2P_TRADING"
echo "  Governance:       $GOVERNANCE"
echo "  Custody Gold:     $CUSTODY_GOLD"
echo "  Custody Silver:   $CUSTODY_SILVER"
echo "  Custody CrudeOil: $CUSTODY_CRUDE_OIL"
echo "  Custody Platinum: $CUSTODY_PLATINUM"
echo ""
echo "  Addresses saved to: $ADDR_FILE"
echo "========================================="

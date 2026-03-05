#!/usr/bin/env bash
set -euo pipefail

# CTC-Perps Local Development Startup
# Starts: Anvil -> Deploy -> Oracle Service -> Frontend

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
ORACLE_DIR="$ROOT_DIR/oracle"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Anvil default keys
DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
# Use Anvil account #1 as oracle signer
SIGNER_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
SIGNER_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

ANVIL_PORT=8545
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

log() {
  echo "[$(date +%H:%M:%S)] $1"
}

# ─── 1. Start Anvil ────────────────────────────────────────────────
log "Starting Anvil on port $ANVIL_PORT..."
anvil --port "$ANVIL_PORT" --block-time 2 --silent &
PIDS+=($!)
sleep 2

# Verify Anvil is running
if ! curl -s http://127.0.0.1:$ANVIL_PORT -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
  echo "ERROR: Anvil failed to start on port $ANVIL_PORT"
  exit 1
fi
log "Anvil running."

# ─── 2. Deploy Contracts ───────────────────────────────────────────
log "Deploying contracts..."
cd "$CONTRACTS_DIR"

DEPLOY_OUTPUT=$(DEPLOYER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" \
  ORACLE_SIGNER="$SIGNER_ADDRESS" \
  forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url "http://127.0.0.1:$ANVIL_PORT" \
    --broadcast \
    --private-key "$DEPLOYER_PRIVATE_KEY" 2>&1)

echo "$DEPLOY_OUTPUT"

# Parse deployed addresses from forge output
extract_addr() {
  echo "$DEPLOY_OUTPUT" | grep "$1:" | tail -1 | awk '{print $NF}'
}

USDC_ADDRESS=$(extract_addr "MockUSDC")
CLP_ADDRESS=$(extract_addr "CLP")
CPERP_ADDRESS=$(extract_addr "CPERP")
ORACLE_ADDRESS=$(extract_addr "Oracle")
POOL_ADDRESS=$(extract_addr "Pool")
FEE_MANAGER_ADDRESS=$(extract_addr "FeeManager")
MARKET_STATE_ADDRESS=$(extract_addr "MarketState")
TRADING_ADDRESS=$(extract_addr "Trading")
VAMM_ADDRESS=$(extract_addr "VAMM")
P2P_TRADING_ADDRESS=$(extract_addr "P2PTrading")
GOVERNANCE_ADDRESS=$(extract_addr "Governance")

log "Contracts deployed."
echo "  MockUSDC:    $USDC_ADDRESS"
echo "  CLP:         $CLP_ADDRESS"
echo "  CPERP:       $CPERP_ADDRESS"
echo "  Oracle:      $ORACLE_ADDRESS"
echo "  Pool:        $POOL_ADDRESS"
echo "  FeeManager:  $FEE_MANAGER_ADDRESS"
echo "  MarketState: $MARKET_STATE_ADDRESS"
echo "  Trading:     $TRADING_ADDRESS"
echo "  VAMM:        $VAMM_ADDRESS"
echo "  P2PTrading:  $P2P_TRADING_ADDRESS"
echo "  Governance:  $GOVERNANCE_ADDRESS"

# ─── 3. Write addresses to frontend config ─────────────────────────
ADDR_FILE="$ROOT_DIR/.addresses.json"
cat > "$ADDR_FILE" << EOF
{
  "mockUSDC": "$USDC_ADDRESS",
  "clp": "$CLP_ADDRESS",
  "cperp": "$CPERP_ADDRESS",
  "oracle": "$ORACLE_ADDRESS",
  "pool": "$POOL_ADDRESS",
  "feeManager": "$FEE_MANAGER_ADDRESS",
  "marketState": "$MARKET_STATE_ADDRESS",
  "trading": "$TRADING_ADDRESS",
  "vamm": "$VAMM_ADDRESS",
  "p2pTrading": "$P2P_TRADING_ADDRESS",
  "governance": "$GOVERNANCE_ADDRESS"
}
EOF
log "Addresses written to .addresses.json"

# ─── 4. Start Oracle Service ───────────────────────────────────────
log "Starting oracle service..."
cd "$ORACLE_DIR"

ORACLE_ADDRESS="$ORACLE_ADDRESS" \
TRADING_ADDRESS="$TRADING_ADDRESS" \
P2P_TRADING_ADDRESS="$P2P_TRADING_ADDRESS" \
MARKET_STATE_ADDRESS="$MARKET_STATE_ADDRESS" \
VAMM_ADDRESS="$VAMM_ADDRESS" \
SIGNER_PRIVATE_KEY="$SIGNER_PRIVATE_KEY" \
RPC_URL="http://127.0.0.1:$ANVIL_PORT" \
CHAIN_ID=31337 \
WS_PORT=8080 \
API_PORT=3001 \
npx tsx src/index.ts &
PIDS+=($!)
sleep 2
log "Oracle service started (WS: 8080, API: 3001)."

# ─── 5. Start Frontend ────────────────────────────────────────────
log "Starting frontend..."
cd "$FRONTEND_DIR"

NEXT_PUBLIC_TRADING_ADDRESS="$TRADING_ADDRESS" \
NEXT_PUBLIC_POOL_ADDRESS="$POOL_ADDRESS" \
NEXT_PUBLIC_MOCK_USDC_ADDRESS="$USDC_ADDRESS" \
NEXT_PUBLIC_MARKET_STATE_ADDRESS="$MARKET_STATE_ADDRESS" \
NEXT_PUBLIC_WS_URL="ws://localhost:8080" \
npx next dev --port 3000 &
PIDS+=($!)

log "Frontend starting on http://localhost:3000"

# ─── Summary ───────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  CTC-Perps Local Stack Running"
echo "========================================="
echo "  Anvil RPC:     http://127.0.0.1:$ANVIL_PORT"
echo "  Oracle WS:     ws://localhost:8080"
echo "  Oracle API:    http://localhost:3001"
echo "  Frontend:      http://localhost:3000"
echo ""
echo "  Deployer:      $DEPLOYER_ADDRESS"
echo "  Oracle Signer: $SIGNER_ADDRESS"
echo "========================================="
echo ""
echo "Press Ctrl+C to stop all services."

# Wait for all background processes
wait

#!/usr/bin/env bash
set -euo pipefail

# CTC-Perps Local Development Startup (fully self-contained)
# Kills stale processes, cleans artifacts, deploys fresh, starts everything.

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
ORACLE_DIR="$ROOT_DIR/oracle"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Foundry binaries (installed via foundryup)
FORGE="${FORGE:-$HOME/.foundry/bin/forge}"
ANVIL="${ANVIL:-$HOME/.foundry/bin/anvil}"

# Anvil default keys
DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
# Use Anvil account #1 as oracle signer
SIGNER_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
SIGNER_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

ANVIL_PORT=8545
WS_PORT=8080
API_PORT=3001
FRONTEND_PORT=3000
DB_URL="postgresql://$(whoami)@localhost:5432/ctc_perps?host=/var/run/postgresql"

PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  # Stop PostgreSQL (only runs with the protocol)
  for pgdir in /opt/homebrew/opt/postgresql@15/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql/bin; do
    if [ -x "$pgdir/pg_ctl" ]; then
      "$pgdir/pg_ctl" -D /opt/homebrew/var/postgresql@15 stop -m fast 2>/dev/null || true
      break
    fi
  done
  echo "Done."
}
trap cleanup EXIT INT TERM

log() {
  echo "[$(date +%H:%M:%S)] $1"
}

# ─── 0. Kill stale processes & clean artifacts ────────────────────
log "Cleaning up stale processes..."
# Kill anything on our ports (try multiple times to be thorough)
for attempt in 1 2; do
  for port in $ANVIL_PORT $WS_PORT $API_PORT $FRONTEND_PORT; do
    pids=$(lsof -ti ":$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      for pid in $pids; do
        log "  Killing PID $pid on port $port"
        kill -9 "$pid" 2>/dev/null || true
      done
    fi
  done
  [ "$attempt" -eq 1 ] && sleep 1
done
# Also kill by process name in case ports aren't bound yet
pkill -9 -f "anvil.*--port.*$ANVIL_PORT" 2>/dev/null || true
pkill -9 -f "tsx src/index.ts" 2>/dev/null || true
pkill -9 -f "next dev.*--port.*$FRONTEND_PORT" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
sleep 2

# Verify ports are free
for port in $ANVIL_PORT $WS_PORT $API_PORT $FRONTEND_PORT; do
  if lsof -ti ":$port" &>/dev/null; then
    log "ERROR: Port $port still in use after cleanup!"
    lsof -i ":$port" 2>/dev/null
    exit 1
  fi
done
log "All ports free."

log "Cleaning broadcast artifacts..."
rm -rf "$CONTRACTS_DIR/broadcast/"

# ─── 0b. Start PostgreSQL & wipe database ────────────────────────
log "Starting PostgreSQL..."
# macOS: Homebrew keg-only PostgreSQL may not be in PATH
for pgdir in /opt/homebrew/opt/postgresql@15/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql/bin; do
  [ -x "$pgdir/psql" ] && export PATH="$pgdir:$PATH" && break
done
# macOS: Start via pg_ctl if available
if [[ "$(uname)" == "Darwin" ]] && command -v pg_ctl &>/dev/null; then
  pg_ctl -D /opt/homebrew/var/postgresql@15 -l /tmp/ctc-postgres.log start 2>/dev/null || true
  sleep 2
fi
# Linux: ensure systemd service is running
if [[ "$(uname)" == "Linux" ]] && command -v systemctl &>/dev/null; then
  systemctl is-active --quiet postgresql || log "WARNING: PostgreSQL service not running. Start with: sudo systemctl start postgresql"
fi
log "Wiping database..."
if command -v psql &>/dev/null; then
  # Try unix socket first (Linux peer auth), fall back to TCP (macOS)
  DB_OK=false
  if psql -U "$(whoami)" -c "SELECT 1" postgres &>/dev/null; then
    psql -U "$(whoami)" -c "DROP DATABASE IF EXISTS ctc_perps;" postgres 2>&1 || true
    psql -U "$(whoami)" -c "CREATE DATABASE ctc_perps;" postgres 2>&1 || true
    DB_OK=true
  elif psql -h localhost -U "$(whoami)" -c "SELECT 1" postgres &>/dev/null; then
    psql -h localhost -U "$(whoami)" -c "DROP DATABASE IF EXISTS ctc_perps;" postgres 2>&1 || true
    psql -h localhost -U "$(whoami)" -c "CREATE DATABASE ctc_perps;" postgres 2>&1 || true
    DB_OK=true
  fi
  if [ "$DB_OK" = true ]; then
    log "PostgreSQL database wiped and recreated."
    cd "$ORACLE_DIR"
    DATABASE_URL="$DB_URL" npx prisma db push --accept-data-loss 2>&1
    if [ $? -eq 0 ]; then
      log "Prisma schema pushed successfully."
    else
      log "WARNING: Prisma schema push failed — oracle will fall back to in-memory mode."
    fi
  else
    log "PostgreSQL not reachable — oracle will use in-memory mode."
  fi
else
  log "psql not found — oracle will use in-memory mode."
fi

# ─── 0c. Install dependencies if needed ──────────────────────────
if [ ! -d "$ORACLE_DIR/node_modules" ]; then
  log "Installing oracle dependencies..."
  cd "$ORACLE_DIR" && npm install
fi
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  log "Installing frontend dependencies..."
  cd "$FRONTEND_DIR" && npm install
fi

# ─── 1. Start Anvil ──────────────────────────────────────────────
log "Starting Anvil on port $ANVIL_PORT..."
"$ANVIL" --port "$ANVIL_PORT" --block-time 2 --silent &
PIDS+=($!)
sleep 2

# Verify Anvil is running
if ! curl -s http://127.0.0.1:$ANVIL_PORT -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
  echo "ERROR: Anvil failed to start on port $ANVIL_PORT"
  exit 1
fi
log "Anvil running (PID ${PIDS[${#PIDS[@]}-1]})."

# ─── 2. Deploy Contracts ─────────────────────────────────────────
log "Deploying contracts..."
cd "$CONTRACTS_DIR"

DEPLOY_OUTPUT=$(DEPLOYER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" \
  ORACLE_SIGNER="$SIGNER_ADDRESS" \
  "$FORGE" script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url "http://127.0.0.1:$ANVIL_PORT" \
    --broadcast \
    --private-key "$DEPLOYER_PRIVATE_KEY" 2>&1)

echo "$DEPLOY_OUTPUT"

# Parse deployed addresses from forge output
# NOTE: "Trading:" must match exactly (not P2PTrading) — use head -1 for first match
extract_addr() {
  echo "$DEPLOY_OUTPUT" | grep "$1:" | tail -1 | awk '{print $NF}'
}

USDC_ADDRESS=$(extract_addr "MockUSDC")
CLP_ADDRESS=$(extract_addr "CLP")
CPERP_ADDRESS=$(extract_addr "CPERP")
ORACLE_CONTRACT_ADDRESS=$(extract_addr "Oracle")
POOL_ADDRESS=$(extract_addr "Pool")
FEE_MANAGER_ADDRESS=$(extract_addr "FeeManager")
MARKET_STATE_ADDRESS=$(extract_addr "MarketState")
TRADING_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "  Trading:" | head -1 | awk '{print $NF}')
VAMM_ADDRESS=$(extract_addr "VAMM")
P2P_TRADING_ADDRESS=$(extract_addr "P2PTrading")
GOVERNANCE_ADDRESS=$(extract_addr "Governance")
CUSTODY_GOLD=$(extract_addr "Custody Gold")
CUSTODY_SILVER=$(extract_addr "Custody Silver")
CUSTODY_CRUDE_OIL=$(extract_addr "Custody CrudeOil")
CUSTODY_PLATINUM=$(extract_addr "Custody Platinum")

# Sanity check: Trading and P2P must be different addresses
if [ "$TRADING_ADDRESS" = "$P2P_TRADING_ADDRESS" ]; then
  echo "ERROR: Trading and P2PTrading resolved to the same address! Parsing bug."
  echo "  Trading:    $TRADING_ADDRESS"
  echo "  P2PTrading: $P2P_TRADING_ADDRESS"
  exit 1
fi

log "Contracts deployed."
echo "  MockUSDC:         $USDC_ADDRESS"
echo "  CLP:              $CLP_ADDRESS"
echo "  CPERP:            $CPERP_ADDRESS"
echo "  Oracle:           $ORACLE_CONTRACT_ADDRESS"
echo "  Pool:             $POOL_ADDRESS"
echo "  FeeManager:       $FEE_MANAGER_ADDRESS"
echo "  MarketState:      $MARKET_STATE_ADDRESS"
echo "  Trading:          $TRADING_ADDRESS"
echo "  VAMM:             $VAMM_ADDRESS"
echo "  P2PTrading:       $P2P_TRADING_ADDRESS"
echo "  Governance:       $GOVERNANCE_ADDRESS"
echo "  Custody Gold:     $CUSTODY_GOLD"
echo "  Custody Silver:   $CUSTODY_SILVER"
echo "  Custody CrudeOil: $CUSTODY_CRUDE_OIL"
echo "  Custody Platinum: $CUSTODY_PLATINUM"

# ─── 3. Write addresses to shared config ─────────────────────────
ADDR_FILE="$ROOT_DIR/.addresses.json"
cat > "$ADDR_FILE" << EOF
{
  "mockUSDC": "$USDC_ADDRESS",
  "clp": "$CLP_ADDRESS",
  "cperp": "$CPERP_ADDRESS",
  "oracle": "$ORACLE_CONTRACT_ADDRESS",
  "pool": "$POOL_ADDRESS",
  "feeManager": "$FEE_MANAGER_ADDRESS",
  "marketState": "$MARKET_STATE_ADDRESS",
  "trading": "$TRADING_ADDRESS",
  "vamm": "$VAMM_ADDRESS",
  "p2pTrading": "$P2P_TRADING_ADDRESS",
  "governance": "$GOVERNANCE_ADDRESS",
  "custodyGold": "$CUSTODY_GOLD",
  "custodySilver": "$CUSTODY_SILVER",
  "custodyCrudeOil": "$CUSTODY_CRUDE_OIL",
  "custodyPlatinum": "$CUSTODY_PLATINUM"
}
EOF
log "Addresses written to .addresses.json"

# Build custody addresses JSON for oracle service
CUSTODY_ADDRESSES="{\"2056\":\"$CUSTODY_GOLD\",\"2069\":\"$CUSTODY_SILVER\",\"2003\":\"$CUSTODY_CRUDE_OIL\",\"2062\":\"$CUSTODY_PLATINUM\"}"

# ─── 4. Start Oracle Service ─────────────────────────────────────
log "Starting oracle service..."
cd "$ORACLE_DIR"

ORACLE_ADDRESS="$ORACLE_CONTRACT_ADDRESS" \
TRADING_ADDRESS="$TRADING_ADDRESS" \
P2P_TRADING_ADDRESS="$P2P_TRADING_ADDRESS" \
MARKET_STATE_ADDRESS="$MARKET_STATE_ADDRESS" \
VAMM_ADDRESS="$VAMM_ADDRESS" \
POOL_ADDRESS="$POOL_ADDRESS" \
FEE_MANAGER_ADDRESS="$FEE_MANAGER_ADDRESS" \
CUSTODY_ADDRESSES="$CUSTODY_ADDRESSES" \
SIGNER_PRIVATE_KEY="$SIGNER_PRIVATE_KEY" \
RPC_URL="http://127.0.0.1:$ANVIL_PORT" \
DATABASE_URL="$DB_URL" \
CHAIN_ID=31337 \
WS_PORT=$WS_PORT \
API_PORT=$API_PORT \
npx tsx src/index.ts &
PIDS+=($!)

# Wait for oracle to be ready (check API endpoint)
log "Waiting for oracle service to be ready..."
for i in $(seq 1 30); do
  if curl -s "http://127.0.0.1:$API_PORT/api/health" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if curl -s "http://127.0.0.1:$API_PORT/api/health" > /dev/null 2>&1; then
  log "Oracle service ready (WS: $WS_PORT, API: $API_PORT, PID ${PIDS[${#PIDS[@]}-1]})."
else
  log "WARNING: Oracle API not responding yet — it may still be starting up."
fi

# ─── 5. Start Frontend ───────────────────────────────────────────
log "Starting frontend..."
cd "$FRONTEND_DIR"

NEXT_PUBLIC_TRADING_ADDRESS="$TRADING_ADDRESS" \
NEXT_PUBLIC_P2P_TRADING_ADDRESS="$P2P_TRADING_ADDRESS" \
NEXT_PUBLIC_POOL_ADDRESS="$POOL_ADDRESS" \
NEXT_PUBLIC_MOCK_USDC_ADDRESS="$USDC_ADDRESS" \
NEXT_PUBLIC_MARKET_STATE_ADDRESS="$MARKET_STATE_ADDRESS" \
NEXT_PUBLIC_ORACLE_ADDRESS="$ORACLE_CONTRACT_ADDRESS" \
NEXT_PUBLIC_VAMM_ADDRESS="$VAMM_ADDRESS" \
NEXT_PUBLIC_GOVERNANCE_ADDRESS="$GOVERNANCE_ADDRESS" \
NEXT_PUBLIC_CLP_ADDRESS="$CLP_ADDRESS" \
NEXT_PUBLIC_CPERP_ADDRESS="$CPERP_ADDRESS" \
NEXT_PUBLIC_FEE_MANAGER_ADDRESS="$FEE_MANAGER_ADDRESS" \
NEXT_PUBLIC_CUSTODY_ADDRESSES="{\"2056\":\"$CUSTODY_GOLD\",\"2069\":\"$CUSTODY_SILVER\",\"2003\":\"$CUSTODY_CRUDE_OIL\",\"2062\":\"$CUSTODY_PLATINUM\"}" \
NEXT_PUBLIC_WS_URL="ws://localhost:$WS_PORT" \
NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" \
NEXT_PUBLIC_RPC_URL="http://127.0.0.1:$ANVIL_PORT" \
NEXT_PUBLIC_CHAIN_ID=31337 \
npx next dev --port $FRONTEND_PORT &
PIDS+=($!)

# Wait for frontend
log "Waiting for frontend to be ready..."
for i in $(seq 1 30); do
  if curl -s "http://127.0.0.1:$FRONTEND_PORT" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done
log "Frontend started (PID ${PIDS[${#PIDS[@]}-1]})."

# ─── Summary ─────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  CTC-Perps Local Stack Running"
echo "========================================="
echo "  Anvil RPC:     http://127.0.0.1:$ANVIL_PORT  (PID ${PIDS[0]})"
echo "  Oracle WS:     ws://localhost:$WS_PORT"
echo "  Oracle API:    http://localhost:$API_PORT      (PID ${PIDS[1]})"
echo "  Frontend:      http://localhost:$FRONTEND_PORT      (PID ${PIDS[2]})"
echo ""
echo "  Deployer:      $DEPLOYER_ADDRESS"
echo "  Oracle Signer: $SIGNER_ADDRESS"
echo "  Governance:    $GOVERNANCE_ADDRESS"
echo "========================================="
echo ""
echo "Press Ctrl+C to stop all services."

# Wait for all background processes
wait

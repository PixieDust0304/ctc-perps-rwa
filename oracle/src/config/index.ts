import dotenv from "dotenv";
dotenv.config();

function parseCustodyAddresses(): Record<number, string> {
  // Support CUSTODY_2056=0x..., CUSTODY_2069=0x..., etc.
  // Also support CUSTODY_ADDRESSES as JSON: {"2056":"0x...","2069":"0x..."}
  const jsonStr = process.env.CUSTODY_ADDRESSES;
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      const result: Record<number, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        result[Number(k)] = v as string;
      }
      return result;
    } catch {}
  }
  const result: Record<number, string> = {};
  for (const feedId of [2056, 2069, 2003, 2062]) {
    const addr = process.env[`CUSTODY_${feedId}`];
    if (addr) result[feedId] = addr;
  }
  return result;
}

export const config = {
  // Autonom Oracle
  autonomUrl: process.env.AUTONOM_URL || "http://178.128.21.71:3000",
  autonomApiKey: process.env.AUTONOM_API_KEY || "readkey1",

  // Feed IDs
  feedIds: [2056, 2069, 2003, 2062] as const,
  feedNames: {
    2056: "Gold/XAU",
    2069: "Silver/XAG",
    2003: "CrudeOil/CL1",
    2062: "Platinum/XPT",
  } as Record<number, string>,

  // Chain
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  chainId: Number(process.env.CHAIN_ID || "31337"), // Anvil default

  // Contracts (populated after deploy)
  oracleAddress: process.env.ORACLE_ADDRESS || "",
  tradingAddress: process.env.TRADING_ADDRESS || "",
  p2pTradingAddress: process.env.P2P_TRADING_ADDRESS || "",
  marketStateAddress: process.env.MARKET_STATE_ADDRESS || "",
  vammAddress: process.env.VAMM_ADDRESS || "",
  poolAddress: process.env.POOL_ADDRESS || "",
  feeManagerAddress: process.env.FEE_MANAGER_ADDRESS || "",

  // Custody addresses per feed (populated after deploy)
  custodyAddresses: parseCustodyAddresses(),

  // Signer
  signerPrivateKey: process.env.SIGNER_PRIVATE_KEY || "",

  // VAMM depth config (dynamic depth = custody LP liquidity * bps / 10000, floor = minDepth)
  vammDepthBps: 8000, // 80% of custody LP liquidity
  vammMinDepth: "100000000000000000000000" as const, // $100K floor in wei (100_000e18)

  // Timings
  fetchIntervalMs: 500,
  stalenessThresholdMs: 210_000,
  frozenTimestampThresholdMs: Number(process.env.FROZEN_TIMESTAMP_THRESHOLD_MS || "30000"),
  feeInterval: 15,

  // Block time — all chain-dependent intervals derive from this.
  // Anvil: 1s, CTC Testnet: 15s. Set via BLOCK_TIME_MS env var.
  blockTimeMs: Number(process.env.BLOCK_TIME_MS || "1000"),

  // Market state detection — debounce + cooldown to prevent false transitions from Autonom lags.
  // Close requires high confidence (60 readings × 500ms = 30s of sustained staleness ON TOP of the 210s threshold).
  // Open recovers faster (6 readings × 500ms = 3s) since fresh data is a strong signal.
  // Cooldown prevents flip-flops entirely — no reverse transition within 5 minutes.
  marketCloseConfirmations: Number(process.env.MARKET_CLOSE_CONFIRMATIONS || "60"),
  marketOpenConfirmations: Number(process.env.MARKET_OPEN_CONFIRMATIONS || "6"),
  marketStateCooldownMs: Number(process.env.MARKET_STATE_COOLDOWN_MS || "300000"),

  // Server
  wsPort: Number(process.env.WS_PORT || "8080"),
  apiPort: Number(process.env.PORT || process.env.API_PORT || "3001"),

  // Database
  databaseUrl: process.env.DATABASE_URL || "",
};

export type FeedId = (typeof config.feedIds)[number];

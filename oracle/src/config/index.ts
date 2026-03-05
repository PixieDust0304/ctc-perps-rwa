import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Autonom Oracle
  autonomUrl: process.env.AUTONOM_URL || "http://178.128.21.71:3000",
  autonomApiKey: process.env.AUTONOM_API_KEY || "readkey1",

  // Feed IDs
  feedIds: [2056, 2069, 2015, 2062] as const,
  feedNames: {
    2056: "Gold/XAU",
    2069: "Silver/XAG",
    2015: "Copper/HG1",
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

  // Signer
  signerPrivateKey: process.env.SIGNER_PRIVATE_KEY || "",

  // Timings
  fetchIntervalMs: 500,
  stalenessThresholdMs: 10_000,
  feeInterval: 15,

  // Server
  wsPort: Number(process.env.WS_PORT || "8080"),
  apiPort: Number(process.env.API_PORT || "3001"),

  // Database
  databaseUrl: process.env.DATABASE_URL || "postgresql://localhost:5432/ctc_perps",
};

export type FeedId = (typeof config.feedIds)[number];

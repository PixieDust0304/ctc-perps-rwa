import { createPublicClient, http, type Hex, getContract } from "viem";
import { config } from "../config/index.js";
import { creditcoinLocal } from "../config/chains.js";
import { getWalletClient } from "../utils/signing.js";
import { logger } from "../utils/logger.js";
import { isMarketOpen } from "../services/marketStateDetector.js";

// Minimal Trading ABI for liquidation
const TRADING_ABI = [
  {
    name: "liquidate",
    type: "function",
    inputs: [{ name: "positionId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/**
 * Main keeper: checks for liquidatable positions during market hours
 */
export async function runMainKeeper(): Promise<void> {
  if (!config.tradingAddress) return;

  // Only run during market hours for each feed
  for (const feedId of config.feedIds) {
    if (!isMarketOpen(feedId)) continue;

    // In a full implementation, we'd query events or an indexer
    // for positions that may be liquidatable.
    // For v1, this is a placeholder that would be wired to
    // position monitoring logic.
    logger.debug("MainKeeper", `Checking liquidations for feed ${feedId}`);
  }
}

/**
 * Start the main keeper loop
 */
export function startMainKeeper(): NodeJS.Timeout {
  logger.info("MainKeeper", "Starting liquidation keeper (500ms interval)");
  return setInterval(async () => {
    try {
      await runMainKeeper();
    } catch (err) {
      logger.error("MainKeeper", `Keeper error: ${(err as Error).message}`);
    }
  }, config.fetchIntervalMs);
}

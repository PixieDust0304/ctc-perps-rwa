import { logger } from "../utils/logger.js";
import type { MarketStateUpdate } from "../types/index.js";

// Track which feeds are currently being settled (no overlap)
const settlementInProgress: Set<number> = new Set();

/**
 * Ensure no overlap between market-open settlement and main keeper
 */
export function isSettlementInProgress(feedId: number): boolean {
  return settlementInProgress.has(feedId);
}

export function startSettlement(feedId: number): boolean {
  if (settlementInProgress.has(feedId)) {
    logger.warn("KeeperCoordinator", `Settlement already in progress for feed ${feedId}`);
    return false;
  }
  settlementInProgress.add(feedId);
  logger.info("KeeperCoordinator", `Settlement started for feed ${feedId}`);
  return true;
}

export function endSettlement(feedId: number): void {
  settlementInProgress.delete(feedId);
  logger.info("KeeperCoordinator", `Settlement completed for feed ${feedId}`);
}

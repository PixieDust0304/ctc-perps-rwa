import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type { PriceTick, MarketStateUpdate } from "../types/index.js";

// Track per-feed market state
const feedStates: Record<number, boolean> = {};

/**
 * Detect market state transitions from fresh flag changes
 */
export function detectMarketStateChanges(ticks: PriceTick[]): MarketStateUpdate[] {
  const updates: MarketStateUpdate[] = [];

  for (const tick of ticks) {
    const previousState = feedStates[tick.feedId];

    if (previousState !== undefined && previousState !== tick.fresh) {
      updates.push({
        feedId: tick.feedId,
        isOpen: tick.fresh,
        timestamp: tick.timestamp,
      });

      const feedName = config.feedNames[tick.feedId] || `Feed ${tick.feedId}`;
      const stateStr = tick.fresh ? "OPEN" : "CLOSED";
      logger.info("MarketState", `${feedName} market ${stateStr}`);
    }

    feedStates[tick.feedId] = tick.fresh;
  }

  return updates;
}

/**
 * Get current market state for a feed
 */
export function isMarketOpen(feedId: number): boolean {
  return feedStates[feedId] ?? false;
}

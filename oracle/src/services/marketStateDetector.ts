import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type { PriceTick, MarketStateUpdate } from "../types/index.js";

interface FeedState {
  /** Current confirmed market state (true = open) */
  isOpen: boolean;
  /** How many consecutive readings agree with the PENDING state (not the current one) */
  pendingCount: number;
  /** The state those consecutive readings are suggesting */
  pendingState: boolean;
  /** Timestamp of the last confirmed state transition */
  lastTransitionAt: number;
}

// Per-feed confirmed state + debounce tracking
const feedStates: Record<number, FeedState> = {};

/**
 * Detect market state transitions from fresh flag changes.
 *
 * Applies two safeguards against false transitions (e.g. Autonom lag):
 *
 * 1. **Debounce** — A state change requires N consecutive readings in the
 *    new state before it fires. Closing requires more confirmations than
 *    opening because a false close (triggering VAMM + settlements) is far
 *    more damaging than a slightly delayed close detection.
 *
 * 2. **Cooldown** — After a transition fires, the opposite transition is
 *    suppressed for a configurable duration. This kills flip-flops dead.
 */
export function detectMarketStateChanges(ticks: PriceTick[]): MarketStateUpdate[] {
  const updates: MarketStateUpdate[] = [];
  const now = Date.now();

  for (const tick of ticks) {
    let state = feedStates[tick.feedId];
    const feedName = config.feedNames[tick.feedId] || `Feed ${tick.feedId}`;

    // First reading ever — initialize and emit initial state
    if (!state) {
      feedStates[tick.feedId] = {
        isOpen: tick.fresh,
        pendingCount: 0,
        pendingState: tick.fresh,
        lastTransitionAt: now,
      };

      updates.push({
        feedId: tick.feedId,
        isOpen: tick.fresh,
        timestamp: tick.timestamp,
      });
      logger.info("MarketState", `${feedName} market ${tick.fresh ? "OPEN" : "CLOSED"} (initial)`);
      continue;
    }

    const incomingState = tick.fresh; // true = open, false = closed

    // If the incoming state matches the CONFIRMED state, reset debounce
    if (incomingState === state.isOpen) {
      if (state.pendingCount > 0) {
        logger.info(
          "MarketState",
          `${feedName}: reading agrees with confirmed=${state.isOpen ? "OPEN" : "CLOSED"}, resetting debounce (was at ${state.pendingCount})`
        );
      }
      state.pendingCount = 0;
      state.pendingState = incomingState;
      continue;
    }

    // Incoming state differs from confirmed state — accumulate debounce
    if (incomingState === state.pendingState) {
      state.pendingCount++;
    } else {
      // Direction flipped mid-debounce (noise) — restart counter
      logger.info(
        "MarketState",
        `${feedName}: direction flipped mid-debounce (was counting toward ${state.pendingState ? "OPEN" : "CLOSED"} at ${state.pendingCount}), restarting toward ${incomingState ? "OPEN" : "CLOSED"}`
      );
      state.pendingState = incomingState;
      state.pendingCount = 1;
    }

    // Determine required confirmations
    const requiredConfirmations = incomingState
      ? config.marketOpenConfirmations   // opening: quick recovery
      : config.marketCloseConfirmations; // closing: high confidence needed

    // Log debounce progress periodically
    if (state.pendingCount % 10 === 0 || state.pendingCount === requiredConfirmations) {
      logger.info(
        "MarketState",
        `${feedName}: debounce ${state.pendingCount}/${requiredConfirmations} toward ${incomingState ? "OPEN" : "CLOSED"} (confirmed=${state.isOpen ? "OPEN" : "CLOSED"})`
      );
    }

    if (state.pendingCount < requiredConfirmations) {
      continue; // not enough consecutive readings yet
    }

    // Check cooldown — don't allow opposite transition too soon
    if (state.lastTransitionAt > 0) {
      const elapsed = now - state.lastTransitionAt;
      if (elapsed < config.marketStateCooldownMs) {
        logger.info(
          "MarketState",
          `${feedName}: transition to ${incomingState ? "OPEN" : "CLOSED"} SUPPRESSED by cooldown (${Math.round((config.marketStateCooldownMs - elapsed) / 1000)}s remaining of ${config.marketStateCooldownMs / 1000}s)`
        );
        continue;
      }
    }

    // Transition confirmed!
    const prevState = state.isOpen;
    state.isOpen = incomingState;
    state.pendingCount = 0;
    state.lastTransitionAt = now;

    updates.push({
      feedId: tick.feedId,
      isOpen: incomingState,
      timestamp: tick.timestamp,
    });

    const stateStr = incomingState ? "OPEN" : "CLOSED";
    logger.info(
      "MarketState",
      `*** ${feedName} market ${prevState ? "OPEN" : "CLOSED"} -> ${stateStr} (confirmed after ${requiredConfirmations} readings) ***`
    );
  }

  return updates;
}

/**
 * Get current confirmed market state for a feed
 */
export function isMarketOpen(feedId: number): boolean {
  return feedStates[feedId]?.isOpen ?? false;
}

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

    // First reading ever — initialize and emit if market is open
    // (on-chain MarketState defaults to false, so we must push the initial open)
    if (!state) {
      feedStates[tick.feedId] = {
        isOpen: tick.fresh,
        pendingCount: 0,
        pendingState: tick.fresh,
        lastTransitionAt: now,
      };

      if (tick.fresh) {
        updates.push({
          feedId: tick.feedId,
          isOpen: true,
          timestamp: tick.timestamp,
        });
        const feedName = config.feedNames[tick.feedId] || `Feed ${tick.feedId}`;
        logger.info("MarketState", `${feedName} market OPEN (initial)`);
      }
      continue;
    }

    const incomingState = tick.fresh; // true = open, false = closed

    // If the incoming state matches the CONFIRMED state, reset debounce
    if (incomingState === state.isOpen) {
      state.pendingCount = 0;
      state.pendingState = incomingState;
      continue;
    }

    // Incoming state differs from confirmed state — accumulate debounce
    if (incomingState === state.pendingState) {
      state.pendingCount++;
    } else {
      // Direction flipped mid-debounce (noise) — restart counter
      state.pendingState = incomingState;
      state.pendingCount = 1;
    }

    // Determine required confirmations
    const requiredConfirmations = incomingState
      ? config.marketOpenConfirmations   // opening: quick recovery
      : config.marketCloseConfirmations; // closing: high confidence needed

    if (state.pendingCount < requiredConfirmations) {
      continue; // not enough consecutive readings yet
    }

    // Check cooldown — don't allow opposite transition too soon
    if (state.lastTransitionAt > 0) {
      const elapsed = now - state.lastTransitionAt;
      if (elapsed < config.marketStateCooldownMs) {
        const feedName = config.feedNames[tick.feedId] || `Feed ${tick.feedId}`;
        logger.debug(
          "MarketState",
          `${feedName} transition to ${incomingState ? "OPEN" : "CLOSED"} suppressed — cooldown (${Math.round((config.marketStateCooldownMs - elapsed) / 1000)}s remaining)`
        );
        continue;
      }
    }

    // Transition confirmed!
    state.isOpen = incomingState;
    state.pendingCount = 0;
    state.lastTransitionAt = now;

    updates.push({
      feedId: tick.feedId,
      isOpen: incomingState,
      timestamp: tick.timestamp,
    });

    const feedName = config.feedNames[tick.feedId] || `Feed ${tick.feedId}`;
    const stateStr = incomingState ? "OPEN" : "CLOSED";
    logger.info("MarketState", `${feedName} market ${stateStr} (confirmed after ${requiredConfirmations} readings)`);
  }

  return updates;
}

/**
 * Get current confirmed market state for a feed
 */
export function isMarketOpen(feedId: number): boolean {
  return feedStates[feedId]?.isOpen ?? false;
}

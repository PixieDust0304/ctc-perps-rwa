import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { getScheduleWindow } from "./scheduleProvider.js";
import type { PriceTick, MarketStateUpdate, MarketState } from "../types/index.js";

interface FeedState {
  /** Current confirmed three-state */
  state: MarketState;
  /** Debounce: how many consecutive readings agree with the pending state */
  pendingCount: number;
  /** The state those consecutive readings are suggesting */
  pendingState: MarketState;
  /** Timestamp of the last confirmed state transition */
  lastTransitionAt: number;
  /** Last schedule-driven state (for detecting schedule boundary changes) */
  lastScheduleWindow: "market_hours" | "off_hours";
}

// Per-feed confirmed state + debounce tracking
const feedStates: Record<number, FeedState> = {};
// Throttle noisy debounce logs (reset/flip) to once per 30s per feed
const lastDebounceLogAt: Record<number, number> = {};

/**
 * Determine the desired market state for a single tick based on:
 * 1. Autonom MARKET_CLOSED error code → CLOSED (overrides schedule)
 * 2. Schedule says off-hours → CLOSED
 * 3. Schedule says market hours + oracle fresh → OPEN
 * 4. Schedule says market hours + oracle stale/frozen → PAUSED
 */
function determineDesiredState(tick: PriceTick): { state: MarketState; reason: string } {
  // Rule 1: Autonom MARKET_CLOSED overrides schedule (handles holidays, early closes)
  if (tick.errorCode === "MARKET_CLOSED") {
    return { state: "CLOSED", reason: "Autonom MARKET_CLOSED (holiday/early close)" };
  }

  // Rule 2: Schedule says off-hours → CLOSED
  const schedule = getScheduleWindow();
  if (schedule === "off_hours") {
    return { state: "CLOSED", reason: "Schedule: off-hours (weekend)" };
  }

  // Rule 3 & 4: Schedule says market hours
  if (tick.fresh) {
    return { state: "OPEN", reason: "Schedule: market hours + oracle fresh" };
  }

  return { state: "PAUSED", reason: "Schedule: market hours + oracle stale/frozen" };
}

/**
 * Get required confirmations for a transition.
 *
 * Schedule-driven transitions (to/from CLOSED via schedule boundary) have NO debounce.
 * MARKET_CLOSED override: 3 readings (~1.5s) — authoritative with minimal noise filter.
 * OPEN → PAUSED: 60 readings (30s) — conservative, prevents false pauses.
 * PAUSED → OPEN: 6 readings (3s) — quick recovery, fresh data is strong signal.
 */
function getRequiredConfirmations(
  from: MarketState,
  to: MarketState,
  isScheduleTransition: boolean,
  isMarketClosedOverride: boolean
): number {
  // Schedule boundary transitions are deterministic — no debounce
  if (isScheduleTransition) return 0;

  // MARKET_CLOSED error override — minimal debounce
  if (isMarketClosedOverride) return config.marketClosedOverrideConfirmations;

  // OPEN ↔ PAUSED transitions within market hours
  if (from === "OPEN" && to === "PAUSED") return config.marketCloseConfirmations;
  if (from === "PAUSED" && to === "OPEN") return config.marketOpenConfirmations;

  // CLOSED → PAUSED (market opens, no data yet) — immediate
  if (from === "CLOSED" && to === "PAUSED") return 0;
  // CLOSED → OPEN (market opens with data) — quick
  if (from === "CLOSED" && to === "OPEN") return config.marketOpenConfirmations;

  // PAUSED → CLOSED (MARKET_CLOSED during pause) — use override confirmations
  if (from === "PAUSED" && to === "CLOSED") return config.marketClosedOverrideConfirmations;
  // OPEN → CLOSED (MARKET_CLOSED during open) — use override confirmations
  if (from === "OPEN" && to === "CLOSED") return config.marketClosedOverrideConfirmations;

  return config.marketCloseConfirmations; // fallback: conservative
}

/**
 * Check if cooldown applies for a transition.
 * Cooldown only applies to OPEN ↔ PAUSED flip-flops during market hours.
 * Schedule-driven and MARKET_CLOSED transitions are never cooled down.
 */
function isCooldownApplicable(
  from: MarketState,
  to: MarketState,
  isScheduleTransition: boolean,
  isMarketClosedOverride: boolean
): boolean {
  if (isScheduleTransition || isMarketClosedOverride) return false;
  // Cooldown only for mid-hours oscillation
  return (from === "OPEN" && to === "PAUSED") || (from === "PAUSED" && to === "OPEN");
}

/**
 * Detect market state transitions from price ticks.
 *
 * Three-state machine: OPEN, PAUSED, CLOSED.
 * - Schedule-driven transitions (weekend boundaries) fire immediately.
 * - MARKET_CLOSED override fires after 3 readings.
 * - OPEN ↔ PAUSED uses existing debounce (60/6) + cooldown (5min).
 */
export function detectMarketStateChanges(ticks: PriceTick[]): MarketStateUpdate[] {
  const updates: MarketStateUpdate[] = [];
  const now = Date.now();
  const currentSchedule = getScheduleWindow();

  for (const tick of ticks) {
    let state = feedStates[tick.feedId];
    const feedName = config.feedNames[tick.feedId] || `Feed ${tick.feedId}`;

    // First reading ever — initialize and emit initial state
    if (!state) {
      const { state: desired, reason } = determineDesiredState(tick);
      feedStates[tick.feedId] = {
        state: desired,
        pendingCount: 0,
        pendingState: desired,
        lastTransitionAt: now,
        lastScheduleWindow: currentSchedule,
      };

      updates.push({
        feedId: tick.feedId,
        state: desired,
        isOpen: desired === "OPEN",
        timestamp: tick.timestamp,
        reason,
      });
      logger.info("MarketState", `${feedName} market ${desired} (initial: ${reason})`);
      continue;
    }

    const { state: desired, reason } = determineDesiredState(tick);

    // Detect schedule boundary change (deterministic, no debounce)
    const isScheduleTransition = currentSchedule !== state.lastScheduleWindow;
    state.lastScheduleWindow = currentSchedule;

    // If the desired state matches confirmed state, reset debounce
    if (desired === state.state) {
      if (state.pendingCount > 0) {
        const lastLog = lastDebounceLogAt[tick.feedId] ?? 0;
        if (now - lastLog > 30_000) {
          logger.info(
            "MarketState",
            `${feedName}: reading agrees with confirmed=${state.state}, resetting debounce (was at ${state.pendingCount})`
          );
          lastDebounceLogAt[tick.feedId] = now;
        }
      }
      state.pendingCount = 0;
      state.pendingState = desired;
      continue;
    }

    const isMarketClosedOverride = tick.errorCode === "MARKET_CLOSED";

    // Schedule transitions fire immediately (0 confirmations required)
    if (isScheduleTransition) {
      const prevState = state.state;
      state.state = desired;
      state.pendingCount = 0;
      state.pendingState = desired;
      state.lastTransitionAt = now;

      updates.push({
        feedId: tick.feedId,
        state: desired,
        isOpen: desired === "OPEN",
        timestamp: tick.timestamp,
        reason,
      });
      logger.info(
        "MarketState",
        `*** ${feedName} market ${prevState} -> ${desired} (schedule boundary: ${reason}) ***`
      );
      continue;
    }

    // Accumulate debounce for non-schedule transitions
    if (desired === state.pendingState) {
      state.pendingCount++;
    } else {
      const lastLog = lastDebounceLogAt[tick.feedId] ?? 0;
      if (now - lastLog > 30_000) {
        logger.info(
          "MarketState",
          `${feedName}: direction flipped mid-debounce (was counting toward ${state.pendingState} at ${state.pendingCount}), restarting toward ${desired}`
        );
        lastDebounceLogAt[tick.feedId] = now;
      }
      state.pendingState = desired;
      state.pendingCount = 1;
    }

    const requiredConfirmations = getRequiredConfirmations(
      state.state,
      desired,
      false,
      isMarketClosedOverride
    );

    // Log debounce progress periodically
    if (requiredConfirmations > 0 && (state.pendingCount % 10 === 0 || state.pendingCount === requiredConfirmations)) {
      logger.info(
        "MarketState",
        `${feedName}: debounce ${state.pendingCount}/${requiredConfirmations} toward ${desired} (confirmed=${state.state})`
      );
    }

    if (state.pendingCount < requiredConfirmations) {
      continue;
    }

    // Check cooldown
    if (isCooldownApplicable(state.state, desired, false, isMarketClosedOverride)) {
      if (state.lastTransitionAt > 0) {
        const elapsed = now - state.lastTransitionAt;
        if (elapsed < config.marketStateCooldownMs) {
          logger.info(
            "MarketState",
            `${feedName}: transition to ${desired} SUPPRESSED by cooldown (${Math.round((config.marketStateCooldownMs - elapsed) / 1000)}s remaining)`
          );
          continue;
        }
      }
    }

    // Transition confirmed!
    const prevState = state.state;
    state.state = desired;
    state.pendingCount = 0;
    state.lastTransitionAt = now;

    updates.push({
      feedId: tick.feedId,
      state: desired,
      isOpen: desired === "OPEN",
      timestamp: tick.timestamp,
      reason,
    });

    logger.info(
      "MarketState",
      `*** ${feedName} market ${prevState} -> ${desired} (confirmed after ${requiredConfirmations} readings: ${reason}) ***`
    );
  }

  return updates;
}

/**
 * Get current confirmed market state for a feed
 */
export function getMarketState(feedId: number): MarketState {
  return feedStates[feedId]?.state ?? "CLOSED";
}

/**
 * Backward-compatible: returns true only when state === "OPEN"
 */
export function isMarketOpen(feedId: number): boolean {
  return feedStates[feedId]?.state === "OPEN";
}

/** Reset module-level state (for testing only) */
export function _resetMarketStateDetector(): void {
  for (const key of Object.keys(feedStates)) delete feedStates[Number(key)];
  for (const key of Object.keys(lastDebounceLogAt)) delete lastDebounceLogAt[Number(key)];
}

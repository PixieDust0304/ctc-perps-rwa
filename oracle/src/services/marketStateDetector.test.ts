import { describe, it, expect, beforeEach } from "vitest";
import { detectMarketStateChanges, isMarketOpen } from "./marketStateDetector.js";
import type { PriceTick } from "../types/index.js";

function makeTick(feedId: number, fresh: boolean, timestamp = Date.now()): PriceTick {
  return {
    feedId,
    price: 3000_000000000000000000n,
    rawPrice: 30000000000000n,
    timestamp,
    fresh,
  };
}

describe("marketStateDetector", () => {
  // Note: the module has global state. Tests depend on execution order.
  // First tick for a feed sets the state, subsequent ticks detect transitions.

  describe("detectMarketStateChanges", () => {
    it("returns empty on first tick (no previous state to compare)", () => {
      // Use a unique feed ID to avoid interference
      const updates = detectMarketStateChanges([makeTick(9001, true)]);
      expect(updates).toEqual([]);
    });

    it("detects transition from open to closed", () => {
      // Set initial state
      detectMarketStateChanges([makeTick(9002, true)]);
      // Transition to closed
      const updates = detectMarketStateChanges([makeTick(9002, false)]);

      expect(updates.length).toBe(1);
      expect(updates[0].feedId).toBe(9002);
      expect(updates[0].isOpen).toBe(false);
    });

    it("detects transition from closed to open", () => {
      detectMarketStateChanges([makeTick(9003, false)]);
      const updates = detectMarketStateChanges([makeTick(9003, true)]);

      expect(updates.length).toBe(1);
      expect(updates[0].feedId).toBe(9003);
      expect(updates[0].isOpen).toBe(true);
    });

    it("returns empty when state unchanged", () => {
      detectMarketStateChanges([makeTick(9004, true)]);
      const updates = detectMarketStateChanges([makeTick(9004, true)]);
      expect(updates).toEqual([]);
    });

    it("handles multiple feeds in single batch", () => {
      // Initialize both feeds
      detectMarketStateChanges([makeTick(9005, true), makeTick(9006, false)]);
      // Transition both
      const updates = detectMarketStateChanges([makeTick(9005, false), makeTick(9006, true)]);

      expect(updates.length).toBe(2);
      expect(updates.find((u) => u.feedId === 9005)?.isOpen).toBe(false);
      expect(updates.find((u) => u.feedId === 9006)?.isOpen).toBe(true);
    });
  });

  describe("isMarketOpen", () => {
    it("returns false for unknown feed", () => {
      expect(isMarketOpen(8888)).toBe(false);
    });

    it("returns current state after ticks processed", () => {
      detectMarketStateChanges([makeTick(9007, true)]);
      expect(isMarketOpen(9007)).toBe(true);

      detectMarketStateChanges([makeTick(9007, false)]);
      expect(isMarketOpen(9007)).toBe(false);
    });
  });
});

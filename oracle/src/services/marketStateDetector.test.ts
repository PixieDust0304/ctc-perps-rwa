import { describe, it, expect, vi } from "vitest";
import type { PriceTick } from "../types/index.js";

// Mock the config module to use test-friendly values
vi.mock("../config/index.js", () => ({
  config: {
    feedNames: { 9001: "TestA", 9002: "TestB", 9003: "TestC", 9004: "TestD", 9005: "TestE", 9006: "TestF", 9007: "TestG", 9010: "TestH" },
    marketCloseConfirmations: 1,
    marketOpenConfirmations: 1,
    marketStateCooldownMs: 0,
  },
}));

import { detectMarketStateChanges, isMarketOpen } from "./marketStateDetector.js";

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
  describe("detectMarketStateChanges", () => {
    it("emits initial state on first tick", () => {
      const updates = detectMarketStateChanges([makeTick(9001, true)]);
      expect(updates.length).toBe(1);
      expect(updates[0].feedId).toBe(9001);
      expect(updates[0].isOpen).toBe(true);
    });

    it("emits initial closed state on first tick", () => {
      const updates = detectMarketStateChanges([makeTick(9010, false)]);
      expect(updates.length).toBe(1);
      expect(updates[0].feedId).toBe(9010);
      expect(updates[0].isOpen).toBe(false);
    });

    it("detects transition from open to closed", () => {
      detectMarketStateChanges([makeTick(9002, true)]);
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
      detectMarketStateChanges([makeTick(9005, true), makeTick(9006, false)]);
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

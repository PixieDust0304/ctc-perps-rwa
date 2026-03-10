import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PriceTick } from "../types/index.js";

// Mock the config module to use test-friendly values
vi.mock("../config/index.js", () => ({
  config: {
    feedNames: { 9001: "TestA", 9002: "TestB", 9003: "TestC", 9004: "TestD", 9005: "TestE", 9006: "TestF", 9007: "TestG", 9010: "TestH", 9011: "TestI", 9012: "TestJ", 9013: "TestK" },
    marketCloseConfirmations: 1,
    marketOpenConfirmations: 1,
    marketStateCooldownMs: 0,
    marketClosedOverrideConfirmations: 1,
    scheduleEnabled: true,
    scheduleTimezone: "America/Chicago",
  },
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Default: schedule says market_hours
let mockScheduleWindow: "market_hours" | "off_hours" = "market_hours";
vi.mock("./scheduleProvider.js", () => ({
  getScheduleWindow: () => mockScheduleWindow,
}));

import { detectMarketStateChanges, isMarketOpen, getMarketState, _resetMarketStateDetector } from "./marketStateDetector.js";

function makeTick(feedId: number, fresh: boolean, opts?: { errorCode?: string; timestamp?: number }): PriceTick {
  return {
    feedId,
    price: 3000_000000000000000000n,
    rawPrice: 30000000000000n,
    timestamp: opts?.timestamp ?? Date.now(),
    fresh,
    errorCode: opts?.errorCode,
  };
}

describe("marketStateDetector (three-state)", () => {
  beforeEach(() => {
    _resetMarketStateDetector();
    mockScheduleWindow = "market_hours";
  });

  describe("OPEN state", () => {
    it("emits OPEN on first fresh tick during market hours", () => {
      const updates = detectMarketStateChanges([makeTick(9001, true)]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("OPEN");
      expect(updates[0].isOpen).toBe(true);
    });

    it("isMarketOpen returns true for OPEN feed", () => {
      detectMarketStateChanges([makeTick(9007, true)]);
      expect(isMarketOpen(9007)).toBe(true);
      expect(getMarketState(9007)).toBe("OPEN");
    });
  });

  describe("PAUSED state", () => {
    it("emits PAUSED on first stale tick during market hours", () => {
      const updates = detectMarketStateChanges([makeTick(9010, false)]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("PAUSED");
      expect(updates[0].isOpen).toBe(false);
    });

    it("transitions OPEN -> PAUSED when oracle goes stale during market hours", () => {
      detectMarketStateChanges([makeTick(9002, true)]);
      const updates = detectMarketStateChanges([makeTick(9002, false)]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("PAUSED");
      expect(updates[0].isOpen).toBe(false);
    });

    it("transitions PAUSED -> OPEN when fresh data resumes", () => {
      detectMarketStateChanges([makeTick(9003, false)]);
      expect(getMarketState(9003)).toBe("PAUSED");

      const updates = detectMarketStateChanges([makeTick(9003, true)]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("OPEN");
      expect(updates[0].isOpen).toBe(true);
    });

    it("isMarketOpen returns false for PAUSED feed", () => {
      detectMarketStateChanges([makeTick(9011, false)]);
      expect(isMarketOpen(9011)).toBe(false);
      expect(getMarketState(9011)).toBe("PAUSED");
    });
  });

  describe("CLOSED state", () => {
    it("emits CLOSED when schedule is off-hours", () => {
      mockScheduleWindow = "off_hours";
      const updates = detectMarketStateChanges([makeTick(9004, false)]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("CLOSED");
      expect(updates[0].isOpen).toBe(false);
    });

    it("emits CLOSED on MARKET_CLOSED error during market hours", () => {
      // First establish OPEN state
      detectMarketStateChanges([makeTick(9012, true)]);
      expect(getMarketState(9012)).toBe("OPEN");

      // MARKET_CLOSED error overrides schedule
      const updates = detectMarketStateChanges([makeTick(9012, false, { errorCode: "MARKET_CLOSED" })]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("CLOSED");
    });

    it("schedule boundary triggers immediate transition to CLOSED", () => {
      // Start in market_hours, OPEN
      detectMarketStateChanges([makeTick(9005, true)]);
      expect(getMarketState(9005)).toBe("OPEN");

      // Schedule flips to off-hours (weekend)
      mockScheduleWindow = "off_hours";
      const updates = detectMarketStateChanges([makeTick(9005, false)]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("CLOSED");
      expect(updates[0].reason?.toLowerCase()).toContain("schedule");
    });
  });

  describe("schedule-driven transitions", () => {
    it("CLOSED -> PAUSED when schedule flips to market hours (no data yet)", () => {
      mockScheduleWindow = "off_hours";
      detectMarketStateChanges([makeTick(9006, false)]);
      expect(getMarketState(9006)).toBe("CLOSED");

      // Schedule flips to market hours, but still stale
      mockScheduleWindow = "market_hours";
      const updates = detectMarketStateChanges([makeTick(9006, false)]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("PAUSED");
    });

    it("CLOSED -> OPEN when schedule flips to market hours with fresh data", () => {
      mockScheduleWindow = "off_hours";
      detectMarketStateChanges([makeTick(9013, false)]);
      expect(getMarketState(9013)).toBe("CLOSED");

      // Schedule flips to market hours with fresh data
      mockScheduleWindow = "market_hours";
      const updates = detectMarketStateChanges([makeTick(9013, true)]);
      expect(updates.length).toBe(1);
      expect(updates[0].state).toBe("OPEN");
    });
  });

  describe("multiple feeds", () => {
    it("handles multiple feeds in single batch independently", () => {
      detectMarketStateChanges([makeTick(9005, true), makeTick(9006, true)]);
      expect(getMarketState(9005)).toBe("OPEN");
      expect(getMarketState(9006)).toBe("OPEN");

      // 9005 goes stale (PAUSED), 9006 stays OPEN
      const updates = detectMarketStateChanges([makeTick(9005, false), makeTick(9006, true)]);
      expect(updates.length).toBe(1);
      expect(updates[0].feedId).toBe(9005);
      expect(updates[0].state).toBe("PAUSED");
    });
  });

  describe("backward compatibility", () => {
    it("isOpen is true only for OPEN state", () => {
      // OPEN
      let updates = detectMarketStateChanges([makeTick(9001, true)]);
      expect(updates[0].isOpen).toBe(true);

      // PAUSED
      updates = detectMarketStateChanges([makeTick(9001, false)]);
      expect(updates[0].isOpen).toBe(false);

      // CLOSED
      mockScheduleWindow = "off_hours";
      updates = detectMarketStateChanges([makeTick(9001, false)]);
      expect(updates[0].isOpen).toBe(false);
    });

    it("isMarketOpen returns false for unknown feed", () => {
      expect(isMarketOpen(8888)).toBe(false);
    });

    it("getMarketState returns CLOSED for unknown feed", () => {
      expect(getMarketState(8888)).toBe("CLOSED");
    });
  });
});

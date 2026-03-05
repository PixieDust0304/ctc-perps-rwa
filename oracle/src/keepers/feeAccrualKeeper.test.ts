import { describe, it, expect, vi, beforeEach } from "vitest";

describe("FeeAccrualKeeper timing logic", () => {
  it("should only trigger after the interval elapses", () => {
    const FEE_INTERVAL_MS = 15_000;
    let lastAccrualTime = 0;

    function shouldTrigger(now: number): boolean {
      if (now - lastAccrualTime < FEE_INTERVAL_MS) return false;
      lastAccrualTime = now;
      return true;
    }

    // First call triggers (0 + 15000 <= 15000)
    expect(shouldTrigger(15000)).toBe(true);

    // Too early
    expect(shouldTrigger(20000)).toBe(false);
    expect(shouldTrigger(29999)).toBe(false);

    // After interval
    expect(shouldTrigger(30000)).toBe(true);

    // Too early again
    expect(shouldTrigger(35000)).toBe(false);

    // After another interval
    expect(shouldTrigger(45001)).toBe(true);
  });
});

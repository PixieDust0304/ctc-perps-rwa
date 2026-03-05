import { describe, it, expect } from "vitest";
import type { Position } from "../types/index.js";

describe("PositionTracker logic", () => {
  it("should track and retrieve open positions by feedId", () => {
    const positions = new Map<string, Position>();

    const pos1: Position = {
      id: "0x0001" as `0x${string}`,
      owner: "0xabc" as `0x${string}`,
      feedId: 2056,
      isLong: true,
      collateral: 100n,
      sizeUsd: 1000n,
      entryPrice: 2000n,
      openTimestamp: 1000n,
      cumulativeBaseFeeSnapshot: 0n,
      cumulativeFundingSnapshot: 0n,
    };

    const pos2: Position = {
      id: "0x0002" as `0x${string}`,
      owner: "0xdef" as `0x${string}`,
      feedId: 2069,
      isLong: false,
      collateral: 50n,
      sizeUsd: 500n,
      entryPrice: 30n,
      openTimestamp: 2000n,
      cumulativeBaseFeeSnapshot: 0n,
      cumulativeFundingSnapshot: 0n,
    };

    const pos3: Position = {
      id: "0x0003" as `0x${string}`,
      owner: "0x123" as `0x${string}`,
      feedId: 2056,
      isLong: false,
      collateral: 200n,
      sizeUsd: 2000n,
      entryPrice: 2100n,
      openTimestamp: 3000n,
      cumulativeBaseFeeSnapshot: 0n,
      cumulativeFundingSnapshot: 0n,
    };

    positions.set(pos1.id, pos1);
    positions.set(pos2.id, pos2);
    positions.set(pos3.id, pos3);

    // Filter by feedId
    const goldPositions = Array.from(positions.values()).filter((p) => p.feedId === 2056);
    expect(goldPositions).toHaveLength(2);

    const silverPositions = Array.from(positions.values()).filter((p) => p.feedId === 2069);
    expect(silverPositions).toHaveLength(1);

    // Remove a position (simulate close event)
    positions.delete("0x0001" as `0x${string}`);
    const remaining = Array.from(positions.values()).filter((p) => p.feedId === 2056);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("0x0003");
  });

  it("should handle removing non-existent position gracefully", () => {
    const positions = new Map<string, Position>();
    positions.delete("0xnonexistent");
    expect(positions.size).toBe(0);
  });
});

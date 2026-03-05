import { describe, it, expect, beforeEach } from "vitest";
import { storePriceTicks, getCandlesSync, getLatestPrice } from "./priceStore.js";
import type { PriceTick } from "../types/index.js";

function makeTick(feedId: number, price: bigint, timestamp: number, fresh = true): PriceTick {
  return { feedId, price, rawPrice: price / (10n ** 8n), timestamp, fresh };
}

describe("priceStore", () => {
  describe("storePriceTicks", () => {
    it("stores ticks and retrieves latest price", () => {
      const tick = makeTick(2056, 3037_700000000000000000n, Date.now());
      storePriceTicks([tick]);

      const latest = getLatestPrice(2056);
      expect(latest).toBeDefined();
      expect(latest!.feedId).toBe(2056);
      expect(latest!.price).toBe(tick.price);
    });

    it("returns undefined for unknown feed", () => {
      expect(getLatestPrice(9999)).toBeUndefined();
    });

    it("returns most recent tick for a feed", () => {
      const now = Date.now();
      storePriceTicks([
        makeTick(2056, 3000_000000000000000000n, now - 1000),
        makeTick(2056, 3100_000000000000000000n, now),
      ]);

      const latest = getLatestPrice(2056);
      expect(latest!.price).toBe(3100_000000000000000000n);
    });
  });

  describe("candle aggregation", () => {
    it("creates candles from ticks", () => {
      // Use unique feed ID to avoid state leaking from other tests
      const CANDLE_FEED = 7001;
      const baseTime = 1700000000000; // fixed timestamp
      const ticks = [
        makeTick(CANDLE_FEED, 3000_000000000000000000n, baseTime),
        makeTick(CANDLE_FEED, 3100_000000000000000000n, baseTime + 1000),
        makeTick(CANDLE_FEED, 2900_000000000000000000n, baseTime + 2000),
        makeTick(CANDLE_FEED, 3050_000000000000000000n, baseTime + 3000),
      ];
      storePriceTicks(ticks);

      const candles = getCandlesSync(CANDLE_FEED, "1m", 10);
      expect(candles.length).toBeGreaterThan(0);

      // Find the candle that contains our ticks
      const candle = candles[0];
      expect(candle.feedId).toBe(CANDLE_FEED);
      expect(candle.interval).toBe("1m");
      // Open should be first tick's price
      expect(candle.open).toBe("3000000000000000000000");
      // High should be highest
      expect(candle.high).toBe("3100000000000000000000");
      // Low should be lowest
      expect(candle.low).toBe("2900000000000000000000");
      // Close should be last tick's price
      expect(candle.close).toBe("3050000000000000000000");
    });

    it("creates candles for multiple intervals", () => {
      const INTERVAL_FEED = 7002;
      const baseTime = 1700000000000;
      storePriceTicks([makeTick(INTERVAL_FEED, 3000_000000000000000000n, baseTime)]);

      // Should have candles for all intervals
      expect(getCandlesSync(INTERVAL_FEED, "15s", 10).length).toBeGreaterThan(0);
      expect(getCandlesSync(INTERVAL_FEED, "1m", 10).length).toBeGreaterThan(0);
      expect(getCandlesSync(INTERVAL_FEED, "5m", 10).length).toBeGreaterThan(0);
      expect(getCandlesSync(INTERVAL_FEED, "15m", 10).length).toBeGreaterThan(0);
      expect(getCandlesSync(INTERVAL_FEED, "1h", 10).length).toBeGreaterThan(0);
    });

    it("separates candles by feed", () => {
      const FEED_A = 7003;
      const FEED_B = 7004;
      const baseTime = 1700000060000;
      storePriceTicks([
        makeTick(FEED_A, 3000_000000000000000000n, baseTime),
        makeTick(FEED_B, 25_000000000000000000n, baseTime),
      ]);

      const goldCandles = getCandlesSync(FEED_A, "1m", 10);
      const silverCandles = getCandlesSync(FEED_B, "1m", 10);

      expect(goldCandles.length).toBeGreaterThan(0);
      expect(silverCandles.length).toBeGreaterThan(0);
      // They should have different prices
      expect(goldCandles[0].open).not.toBe(silverCandles[0].open);
    });

    it("respects limit parameter", () => {
      const baseTime = 1700000120000;
      // Create ticks across different minute buckets
      for (let i = 0; i < 5; i++) {
        storePriceTicks([makeTick(2003, 4_500000000000000000n, baseTime + i * 60000)]);
      }

      const limited = getCandlesSync(2003, "1m", 2);
      expect(limited.length).toBeLessThanOrEqual(2);
    });
  });
});

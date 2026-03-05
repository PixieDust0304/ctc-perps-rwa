import { logger } from "../utils/logger.js";
import type { PriceTick, CandleData } from "../types/index.js";
import { persistPriceTicks, persistCandle, queryCandles, getPrisma } from "./database.js";

// In-memory candle store (always active as primary fast path)
const candles: Map<string, CandleData> = new Map();
const priceTicks: PriceTick[] = [];

const MAX_TICKS = 100_000;

/**
 * Store a batch of price ticks
 */
export function storePriceTicks(ticks: PriceTick[]) {
  priceTicks.push(...ticks);

  // Trim to prevent memory leak
  if (priceTicks.length > MAX_TICKS) {
    priceTicks.splice(0, priceTicks.length - MAX_TICKS);
  }

  // Update in-memory candles
  for (const tick of ticks) {
    updateCandle(tick, "15s");
    updateCandle(tick, "1m");
    updateCandle(tick, "5m");
    updateCandle(tick, "15m");
    updateCandle(tick, "1h");
  }

  // Async persist to DB (fire and forget)
  persistPriceTicks(ticks).catch(() => {});
}

function updateCandle(tick: PriceTick, interval: string) {
  const intervalMs = intervalToMs(interval);
  const bucketTs = Math.floor(tick.timestamp / intervalMs) * intervalMs;
  const key = `${tick.feedId}-${interval}-${bucketTs}`;

  const priceStr = tick.price.toString();
  const existing = candles.get(key);

  if (existing) {
    if (BigInt(priceStr) > BigInt(existing.high)) existing.high = priceStr;
    if (BigInt(priceStr) < BigInt(existing.low)) existing.low = priceStr;
    existing.close = priceStr;
  } else {
    candles.set(key, {
      feedId: tick.feedId,
      interval,
      open: priceStr,
      high: priceStr,
      low: priceStr,
      close: priceStr,
      volume: "0",
      timestamp: bucketTs,
    });
  }

  // Async persist candle to DB
  const candle = candles.get(key)!;
  persistCandle(candle).catch(() => {});
}

function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    "15s": 15_000,
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
  };
  return map[interval] || 60_000;
}

/**
 * Get candles for a feed and interval.
 * Tries DB first if available, falls back to in-memory.
 */
export async function getCandlesAsync(
  feedId: number,
  interval: string,
  limit: number = 100
): Promise<CandleData[]> {
  // Try DB first
  if (getPrisma()) {
    const dbCandles = await queryCandles(feedId, interval, limit);
    if (dbCandles.length > 0) return dbCandles;
  }

  // Fallback to in-memory
  return getCandlesSync(feedId, interval, limit);
}

/**
 * Synchronous in-memory candle fetch (always works)
 */
export function getCandlesSync(
  feedId: number,
  interval: string,
  limit: number = 100
): CandleData[] {
  const results: CandleData[] = [];
  for (const [, candle] of candles) {
    if (candle.feedId === feedId && candle.interval === interval) {
      results.push(candle);
    }
  }
  results.sort((a, b) => b.timestamp - a.timestamp);
  return results.slice(0, limit);
}

// Keep backward compat export
export const getCandles = getCandlesSync;

/**
 * Get latest price for a feed
 */
export function getLatestPrice(feedId: number): PriceTick | undefined {
  for (let i = priceTicks.length - 1; i >= 0; i--) {
    if (priceTicks[i].feedId === feedId) return priceTicks[i];
  }
  return undefined;
}

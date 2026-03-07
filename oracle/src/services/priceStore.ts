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
    updateCandle(tick, "10m");
    updateCandle(tick, "15m");
    updateCandle(tick, "30m");
    updateCandle(tick, "1h");
    updateCandle(tick, "6h");
    updateCandle(tick, "12h");
    updateCandle(tick, "1d");
  }

  // Async persist to DB (fire and forget)
  persistPriceTicks(ticks).catch(() => {});
}

function updateCandle(tick: PriceTick, interval: string) {
  const intervalMs = intervalToMs(interval);
  const bucketTs = Math.floor(tick.timestamp / intervalMs) * intervalMs;
  const key = `${tick.feedId}-${interval}-${bucketTs}`;

  const priceStr = tick.price.toString();
  const source = tick.source ?? "oracle";
  const existing = candles.get(key);

  if (existing) {
    if (BigInt(priceStr) > BigInt(existing.high)) existing.high = priceStr;
    if (BigInt(priceStr) < BigInt(existing.low)) existing.low = priceStr;
    existing.close = priceStr;
    existing.source = source;
  } else {
    candles.set(key, {
      feedId: tick.feedId,
      interval,
      open: priceStr,
      high: priceStr,
      low: priceStr,
      close: priceStr,
      volume: "0",
      source,
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
    "10m": 600_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "6h": 21_600_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
  };
  return map[interval] || 60_000;
}

/**
 * Get price movement stats for a feed over a given lookback duration.
 * Returns the oldest and newest price in the window + net change.
 */
export function getPriceMovement(
  feedId: number,
  lookbackMs: number
): { startPrice: number; endPrice: number; changePercent: number } | null {
  const now = Date.now();
  const cutoff = now - lookbackMs;

  let oldest: PriceTick | null = null;
  let newest: PriceTick | null = null;

  // Scan backwards. Don't break on cutoff — ticks are interleaved across feeds.
  // Use a generous early-exit: stop once we've gone 2x past the lookback for any feed.
  const hardCutoff = now - lookbackMs * 2;

  for (let i = priceTicks.length - 1; i >= 0; i--) {
    const tick = priceTicks[i];
    if (tick.timestamp < hardCutoff) break;
    if (tick.feedId !== feedId) continue;
    if (tick.timestamp < cutoff) continue;
    if (!newest) newest = tick;
    oldest = tick;
  }

  // If we only have 1 tick in the window, grab the most recent tick before the cutoff as start
  if (newest && (!oldest || oldest === newest)) {
    for (let i = priceTicks.length - 1; i >= 0; i--) {
      const tick = priceTicks[i];
      if (tick.feedId !== feedId) continue;
      if (tick.timestamp < cutoff) {
        oldest = tick;
        break;
      }
    }
  }

  if (!oldest || !newest) return null;

  const startPrice = Number(oldest.price) / 1e18;
  const endPrice = Number(newest.price) / 1e18;
  const changePercent = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

  return { startPrice, endPrice, changePercent };
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
  results.sort((a, b) => a.timestamp - b.timestamp);
  return results.slice(-limit);
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

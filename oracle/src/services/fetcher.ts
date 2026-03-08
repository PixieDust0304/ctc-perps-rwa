import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getLatestPrice } from "./priceStore.js";
import type { AutonomResponse, PriceTick } from "../types/index.js";

const ORACLE_TO_18_MULTIPLIER = 10n ** 8n;

// Throttle steady-state logs to reduce noise
let lastBatchLogAt = 0;
let lastBatchSignature = "";
const lastStaleLogAt: Record<number, number> = {};
const lastMissingLogAt: Record<number, number> = {};
const lastErrorLogAt: Record<number, number> = {};

/**
 * Fetch latest prices from Autonom oracle API
 */
export async function fetchPrices(): Promise<PriceTick[]> {
  const url = `${config.autonomUrl}/prices/batch?feed_ids=${config.feedIds.join(",")}`;

  const response = await fetch(url, {
    headers: { "x-api-key": config.autonomApiKey },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Autonom API error: ${response.status} ${response.statusText}`);
  }

  const data: AutonomResponse = await response.json();

  // Build per-feed error set — ANY error code means the feed is unavailable/closed
  const errorFeedIds = new Set<number>();
  const now = Date.now();
  if (data.errors) {
    for (const e of data.errors) {
      errorFeedIds.add(e.feed_id);
      const lastLog = lastErrorLogAt[e.feed_id] || 0;
      if (now - lastLog > 30_000) {
        logger.info(
          "Fetcher",
          `Autonom error for ${config.feedNames[e.feed_id] || e.feed_id}: ${e.code} — ${e.message}`
        );
        lastErrorLogAt[e.feed_id] = now;
      }
    }
  }

  const ticks: PriceTick[] = [];
  const seenFeeds = new Set<number>();

  // Process returned prices — per-feed fresh determination
  for (const p of data.prices) {
    seenFeeds.add(p.feed_id);
    const feedHasError = errorFeedIds.has(p.feed_id);
    const ageMs = now - p.timestamp;
    const feedStale = ageMs > config.stalenessThresholdMs;
    const fresh = !feedHasError && !feedStale;
    const feedName = config.feedNames[p.feed_id] || `Feed ${p.feed_id}`;

    if (!fresh) {
      const lastLog = lastStaleLogAt[p.feed_id] || 0;
      if (now - lastLog > 30_000) {
        logger.info(
          "Fetcher",
          `${feedName}: STALE (age=${Math.round(ageMs / 1000)}s, threshold=${config.stalenessThresholdMs / 1000}s, error=${feedHasError})`
        );
        lastStaleLogAt[p.feed_id] = now;
      }
    }

    ticks.push({
      feedId: p.feed_id,
      rawPrice: BigInt(p.price),
      price: BigInt(p.price) * ORACLE_TO_18_MULTIPLIER,
      timestamp: p.timestamp,
      fresh,
    });
  }

  // For feeds missing from response, emit stale tick using last known price.
  // ANY missing feed is treated as stale — Autonom errors (SELECTION_FAILED,
  // MARKET_CLOSED, etc.) all mean the feed is unavailable.
  for (const feedId of config.feedIds) {
    if (!seenFeeds.has(feedId)) {
      const last = getLatestPrice(feedId);
      const feedName = config.feedNames[feedId] || `Feed ${feedId}`;
      const hasError = errorFeedIds.has(feedId);
      const lastLog = lastMissingLogAt[feedId] || 0;
      if (now - lastLog > 30_000) {
        logger.info(
          "Fetcher",
          `${feedName}: MISSING from response (error=${hasError}), emitting stale tick with last known price`
        );
        lastMissingLogAt[feedId] = now;
      }
      ticks.push({
        feedId,
        rawPrice: last ? last.rawPrice : 0n,
        price: last ? last.price : 0n,
        timestamp: last ? last.timestamp : now,
        fresh: false, // Always stale — feed is missing/errored
      });
    }
  }

  // Throttle steady-state batch log — only log when fresh/stale signature changes or every 30s
  const sortedTicks = [...ticks].sort((a, b) => a.feedId - b.feedId);
  const batchSig = sortedTicks.map(t => `${t.feedId}:${t.fresh}`).join(",");
  const now2 = Date.now();
  if (batchSig !== lastBatchSignature || now2 - lastBatchLogAt > 30_000) {
    logger.info(
      "Fetcher",
      `Batch: ${ticks.filter(t => t.fresh).length} fresh, ${ticks.filter(t => !t.fresh).length} stale | ${sortedTicks.map((t) => `${config.feedNames[t.feedId]}: $${(Number(t.price) / 1e18).toFixed(2)} ${t.fresh ? "FRESH" : "STALE"}`).join(" | ")}`
    );
    lastBatchLogAt = now2;
    lastBatchSignature = batchSig;
  }

  return ticks;
}

/**
 * Start continuous price fetching at configured interval
 */
export function startFetcher(onPrices: (ticks: PriceTick[]) => Promise<void> | void): NodeJS.Timeout {
  logger.info("Fetcher", `Starting price fetcher (${config.fetchIntervalMs}ms interval)`);

  const interval = setInterval(async () => {
    try {
      const ticks = await fetchPrices();
      await onPrices(ticks);
    } catch (err) {
      logger.error("Fetcher", `Fetch failed: ${(err as Error).message}`);
    }
  }, config.fetchIntervalMs);

  return interval;
}

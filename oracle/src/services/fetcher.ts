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
const lastTimestampAdvanceAt: Record<number, number> = {};
const lastSeenTimestamp: Record<number, number> = {};

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

  // Build per-feed error map — tracks error code for downstream (marketStateDetector)
  const feedErrorCodes = new Map<number, string>();
  const now = Date.now();
  if (data.errors) {
    for (const e of data.errors) {
      feedErrorCodes.set(e.feed_id, e.code);
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
    const feedHasError = feedErrorCodes.has(p.feed_id);
    const ageMs = now - p.timestamp;
    const feedStale = ageMs > config.stalenessThresholdMs;

    // Detect frozen upstream timestamps: if the source timestamp hasn't advanced
    // for frozenTimestampThresholdMs (default 30s), mark stale early — don't wait
    // for the full 210s age threshold to expire on-chain.
    const prevTimestamp = lastSeenTimestamp[p.feed_id];
    if (prevTimestamp === undefined || p.timestamp > prevTimestamp) {
      lastTimestampAdvanceAt[p.feed_id] = now;
    }
    lastSeenTimestamp[p.feed_id] = p.timestamp;
    const timeSinceLastAdvance = now - (lastTimestampAdvanceAt[p.feed_id] ?? now);
    const isFrozen = timeSinceLastAdvance > config.frozenTimestampThresholdMs;

    const fresh = !feedHasError && !feedStale && !isFrozen;
    const feedName = config.feedNames[p.feed_id] || `Feed ${p.feed_id}`;

    if (!fresh) {
      const lastLog = lastStaleLogAt[p.feed_id] || 0;
      if (now - lastLog > 30_000) {
        logger.info(
          "Fetcher",
          `${feedName}: STALE (age=${Math.round(ageMs / 1000)}s, threshold=${config.stalenessThresholdMs / 1000}s, error=${feedHasError}, frozen=${isFrozen}${isFrozen ? ` [${Math.round(timeSinceLastAdvance / 1000)}s since last advance]` : ""})`
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
      errorCode: feedErrorCodes.get(p.feed_id),
    });
  }

  // For feeds missing from response, emit stale tick using last known price.
  // ANY missing feed is treated as stale — Autonom errors (SELECTION_FAILED,
  // MARKET_CLOSED, etc.) all mean the feed is unavailable.
  for (const feedId of config.feedIds) {
    if (!seenFeeds.has(feedId)) {
      const last = getLatestPrice(feedId);
      const feedName = config.feedNames[feedId] || `Feed ${feedId}`;
      const hasError = feedErrorCodes.has(feedId);
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
        errorCode: feedErrorCodes.get(feedId),
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

/** Reset module-level state (for testing only) */
export function _resetFetcherState(): void {
  lastBatchLogAt = 0;
  lastBatchSignature = "";
  for (const key of Object.keys(lastStaleLogAt)) delete lastStaleLogAt[Number(key)];
  for (const key of Object.keys(lastMissingLogAt)) delete lastMissingLogAt[Number(key)];
  for (const key of Object.keys(lastErrorLogAt)) delete lastErrorLogAt[Number(key)];
  for (const key of Object.keys(lastTimestampAdvanceAt)) delete lastTimestampAdvanceAt[Number(key)];
  for (const key of Object.keys(lastSeenTimestamp)) delete lastSeenTimestamp[Number(key)];
}

/**
 * Start continuous price fetching at configured interval.
 * Sequential while(true) loop — guarantees no concurrent onPrices callbacks.
 * Sleep accounts for processing time so cycles are spaced from start, not completion.
 */
export async function startFetcher(
  onPrices: (ticks: PriceTick[]) => Promise<void>
): Promise<never> {
  logger.info(
    "Fetcher",
    `Starting price fetcher (${config.fetchIntervalMs}ms interval, sequential)`
  );

  while (true) {
    const cycleStart = Date.now();
    try {
      const ticks = await fetchPrices();
      await onPrices(ticks);
    } catch (err) {
      logger.error("Fetcher", `Fetch failed: ${(err as Error).message}`);
    }
    const sleepMs = Math.max(
      0,
      config.fetchIntervalMs - (Date.now() - cycleStart)
    );
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }
}

import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getLatestPrice } from "./priceStore.js";
import type { AutonomResponse, PriceTick } from "../types/index.js";

const ORACLE_TO_18_MULTIPLIER = 10n ** 8n;

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

  // Build per-feed closed set from explicit MARKET_CLOSED errors
  const closedFeedIds = new Set<number>();
  if (data.errors) {
    for (const e of data.errors) {
      if (e.code === "MARKET_CLOSED") {
        closedFeedIds.add(e.feed_id);
      }
    }
  }

  const now = Date.now();
  const ticks: PriceTick[] = [];
  const seenFeeds = new Set<number>();

  // Process returned prices — per-feed fresh determination
  for (const p of data.prices) {
    seenFeeds.add(p.feed_id);
    const feedExplicitlyClosed = closedFeedIds.has(p.feed_id);
    const feedStale = now - p.timestamp > config.stalenessThresholdMs;

    ticks.push({
      feedId: p.feed_id,
      rawPrice: BigInt(p.price),
      price: BigInt(p.price) * ORACLE_TO_18_MULTIPLIER,
      timestamp: p.timestamp,
      fresh: !feedExplicitlyClosed && !feedStale,
    });
  }

  // For feeds with MARKET_CLOSED errors but no price data, emit stale tick
  const anyFeedClosed = closedFeedIds.size > 0;
  const allReturnedStale = ticks.length > 0 && ticks.every((t) => !t.fresh);
  for (const feedId of config.feedIds) {
    if (!seenFeeds.has(feedId)) {
      const last = getLatestPrice(feedId);
      // If this feed is explicitly closed, OR all returned feeds are stale/closed, emit stale
      const feedClosed = closedFeedIds.has(feedId) || anyFeedClosed || allReturnedStale;
      ticks.push({
        feedId,
        rawPrice: last ? last.rawPrice : 0n,
        price: last ? last.price : 0n,
        timestamp: Date.now(),
        fresh: !feedClosed,
      });
    }
  }

  logger.debug(
    "Fetcher",
    `Fetched ${ticks.length} prices (${ticks.filter(t => t.fresh).length} fresh, ${ticks.filter(t => !t.fresh).length} closed)`,
    ticks.map((t) => `${config.feedNames[t.feedId]}: $${Number(t.price) / 1e18} ${t.fresh ? "" : "(closed)"}`)
  );

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

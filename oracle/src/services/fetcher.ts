import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
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

  const ticks: PriceTick[] = data.prices.map((p) => ({
    feedId: p.feed_id,
    rawPrice: BigInt(p.price),
    price: BigInt(p.price) * ORACLE_TO_18_MULTIPLIER,
    timestamp: p.timestamp,
    fresh: data.request.fresh,
  }));

  logger.debug(
    "Fetcher",
    `Fetched ${ticks.length} prices, fresh=${data.request.fresh}`,
    ticks.map((t) => `${config.feedNames[t.feedId]}: $${Number(t.price) / 1e18}`)
  );

  return ticks;
}

/**
 * Start continuous price fetching at configured interval
 */
export function startFetcher(onPrices: (ticks: PriceTick[]) => void): NodeJS.Timeout {
  logger.info("Fetcher", `Starting price fetcher (${config.fetchIntervalMs}ms interval)`);

  const interval = setInterval(async () => {
    try {
      const ticks = await fetchPrices();
      onPrices(ticks);
    } catch (err) {
      logger.error("Fetcher", `Fetch failed: ${(err as Error).message}`);
    }
  }, config.fetchIntervalMs);

  return interval;
}

import {
  createPublicClient,
  http,
  type Hex,
} from "viem";
import { config } from "../config/index.js";
import { getChain } from "../config/chains.js";
import { OracleABI } from "../abi/index.js";
import { getWalletClient, signPriceBatch } from "../utils/signing.js";
import { sendTx } from "../utils/txSender.js";
import { logger } from "../utils/logger.js";
import { checkAndLiquidateAll } from "../keepers/liquidationEngine.js";
import type { PriceTick } from "../types/index.js";

// What we last successfully pushed on-chain. Updated ONLY on successful push
// so failed pushes retry next cycle.
const cachedPrices = new Map<number, { rawPrice: bigint; fresh: boolean }>();

// Timestamp of last successful chain push — used for heartbeat timing only.
let lastChainPushAt = 0;

// Per-feed last pushed timestamps — needed for synthetic timestamp computation.
let lastPushedTimestamps: Record<number, number> = {};

/**
 * Read current on-chain prices for all feeds to populate the cache at boot.
 * Uses Promise.allSettled so uninitialized feeds (first deploy) don't block others.
 */
export async function initOnChainState(): Promise<void> {
  if (!config.oracleAddress) return;

  const publicClient = createPublicClient({
    chain: getChain(),
    transport: http(config.rpcUrl),
  });

  const results = await Promise.allSettled(
    config.feedIds.map(async (feedId) => {
      // getPrice reverts with "Oracle: no price" on uninitialized feeds (first deploy)
      const data = await publicClient.readContract({
        address: config.oracleAddress as Hex,
        abi: OracleABI,
        functionName: "getPrice",
        args: [feedId],
      });
      // data is { price: bigint, timestamp: bigint, fresh: boolean } (named tuple per ABI)
      const rawPrice = (data as any).price / (10n ** 8n); // back-convert 18-dec to 10-dec
      cachedPrices.set(feedId, { rawPrice, fresh: (data as any).fresh });
      lastPushedTimestamps[feedId] = Number((data as any).timestamp) * 1000;
      logger.info(
        "ChainPusher",
        `On-chain feed ${feedId}: rawPrice=${rawPrice}, fresh=${(data as any).fresh}, ts=${(data as any).timestamp}`
      );
    })
  );

  // Log any feeds that failed (expected on first deploy)
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      logger.info(
        "ChainPusher",
        `No on-chain price for feed ${config.feedIds[i]} (first deploy?)`
      );
    }
  }
  lastChainPushAt = Date.now();
}

/**
 * Push price ticks to the Oracle contract on-chain.
 *
 * Only pushes when prices actually changed or heartbeat is due (180s).
 * Sequential fetcher loop guarantees no concurrent invocations.
 */
export async function pushPrices(ticks: PriceTick[]): Promise<void> {
  if (!config.oracleAddress) {
    logger.warn("ChainPusher", "Oracle address not configured, skipping push");
    return;
  }

  // Filter to ticks with valid prices
  const validTicks = ticks.filter((t) => t.rawPrice > 0n);
  if (validTicks.length === 0) return;

  // Check if any feed's (rawPrice, fresh) differs from cached state
  let hasChange = false;
  for (const tick of validTicks) {
    const cached = cachedPrices.get(tick.feedId);
    if (!cached || cached.rawPrice !== tick.rawPrice || cached.fresh !== tick.fresh) {
      hasChange = true;
      break;
    }
  }

  const heartbeatDue = Date.now() - lastChainPushAt >= config.heartbeatIntervalMs;

  if (!hasChange && !heartbeatDue) return;

  const reason = hasChange ? "price change" : "heartbeat";
  logger.info(
    "ChainPusher",
    `Pushing ${validTicks.length} ticks (${reason}): ${validTicks.map((t) => `${t.feedId}(${t.fresh ? "fresh" : "stale"})`).join(", ")}`
  );

  const feedIds = validTicks.map((t) => t.feedId);
  const rawPrices = validTicks.map((t) => t.rawPrice);

  // Synthetic timestamps — Oracle requires strictly-increasing per feed.
  // max(tickTsSec, lastPushedSec + 1, currentTimeSec)
  const currentTimeSec = BigInt(Math.floor(Date.now() / 1000));
  const timestamps = validTicks.map((t) => {
    const tickTsSec = BigInt(Math.floor(t.timestamp / 1000));
    const lastPushedSec = BigInt(
      Math.floor((lastPushedTimestamps[t.feedId] || 0) / 1000)
    );
    if (tickTsSec > lastPushedSec) return tickTsSec;
    const synthetic = lastPushedSec + 1n;
    return synthetic > currentTimeSec ? synthetic : currentTimeSec;
  });
  const freshFlags = validTicks.map((t) => t.fresh);

  let pushSucceeded = false;
  try {
    const signature = await signPriceBatch(
      feedIds,
      rawPrices,
      timestamps,
      freshFlags
    );

    const walletClient = getWalletClient();
    const publicClient = createPublicClient({
      chain: getChain(),
      transport: http(config.rpcUrl),
    });

    const { request } = await publicClient.simulateContract({
      address: config.oracleAddress as Hex,
      abi: OracleABI,
      functionName: "updatePrices",
      args: [
        feedIds.map((id) => id),
        rawPrices,
        timestamps,
        freshFlags,
        signature,
      ],
      account: walletClient.account,
    });

    const txHash = await sendTx(request);
    logger.info("ChainPusher", `Prices pushed, tx: ${txHash}`);

    // Wait for block confirmation so on-chain price is fresh for liquidation checks.
    try {
      await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: config.blockTimeMs * 2,
      });
    } catch {
      logger.warn("ChainPusher", `Receipt timeout for ${txHash}, continuing`);
    }
    pushSucceeded = true;
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("stale update")) {
      logger.debug(
        "ChainPusher",
        "Skipping: on-chain timestamps are current"
      );
      pushSucceeded = true;
    } else if (msg.includes("already known")) {
      logger.debug("ChainPusher", "Skipping: tx already in mempool");
      pushSucceeded = true;
    } else if (msg.includes("replacement transaction underpriced")) {
      logger.debug(
        "ChainPusher",
        "Skipping: nonce conflict (overlapping push)"
      );
    } else {
      logger.warn("ChainPusher", `Push failed: ${msg.slice(0, 200)}`);
    }
  }

  // Update state only on success — failed pushes retry next cycle
  if (pushSucceeded) {
    lastChainPushAt = Date.now();
    for (let i = 0; i < validTicks.length; i++) {
      cachedPrices.set(validTicks[i].feedId, {
        rawPrice: validTicks[i].rawPrice,
        fresh: validTicks[i].fresh,
      });
      const syntheticMs = Number(timestamps[i]) * 1000;
      lastPushedTimestamps[validTicks[i].feedId] = Math.max(
        validTicks[i].timestamp,
        syntheticMs
      );
    }
  }

  // Liquidation check — only when push confirmed on-chain
  if (pushSucceeded) {
    try {
      await checkAndLiquidateAll(validTicks);
    } catch (err) {
      logger.warn(
        "ChainPusher",
        `Liquidation check error: ${(err as Error).message}`
      );
    }
  } else {
    logger.warn(
      "ChainPusher",
      "Skipping liquidation check — on-chain price not confirmed current"
    );
  }
}

/** Reset module-level state (for testing only) */
export function _resetChainPusherState(): void {
  cachedPrices.clear();
  lastChainPushAt = 0;
  lastPushedTimestamps = {};
}

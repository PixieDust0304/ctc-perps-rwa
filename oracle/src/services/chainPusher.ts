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
import { maybeTriggerAccrual } from "../keepers/feeAccrualKeeper.js";
import { checkAndLiquidateAll } from "../keepers/liquidationEngine.js";
import type { PriceTick } from "../types/index.js";

let lastPushedTimestamps: Record<number, number> = {};
let lastPushedFreshFlags: Record<number, boolean> = {};
let hasEverPushed = false;
let lastPushLogAt = 0;
let lastChainPushAt = 0;

/**
 * Push price ticks to the Oracle contract onchain
 */
export async function pushPrices(ticks: PriceTick[]): Promise<void> {
  if (!config.oracleAddress) {
    logger.warn("ChainPusher", "Oracle address not configured, skipping push");
    return;
  }

  // Throttle chain pushes to ~1 per block (no point submitting faster than block time)
  const now = Date.now();
  if (hasEverPushed && now - lastChainPushAt < config.blockTimeMs) return;

  // First push: include all ticks so on-chain Oracle has data for MarketState.
  // After that: push fresh ticks with advancing timestamps, OR push once when
  // a feed's fresh flag flips to false (frozen upstream) to flip on-chain fresh.
  const filteredTicks = ticks.filter((t) => {
    if (t.rawPrice <= 0n) return false;
    if (!hasEverPushed) return true;
    const lastTs = lastPushedTimestamps[t.feedId] || 0;
    if (t.timestamp > lastTs) return true;
    // Frozen timestamp: push once when fresh flips to false
    if (!t.fresh && lastPushedFreshFlags[t.feedId] === true) return true;
    return false;
  });
  if (filteredTicks.length === 0) return;

  if (now - lastPushLogAt > 10_000) {
    logger.info(
      "ChainPusher",
      `Pushing ${filteredTicks.length} ticks: ${filteredTicks.map(t => `${t.feedId}(${t.fresh ? "fresh" : "stale"})`).join(", ")}`
    );
    lastPushLogAt = now;
  }

  const feedIds = filteredTicks.map((t) => t.feedId);
  const rawPrices = filteredTicks.map((t) => t.rawPrice);
  // Use synthetic timestamp when the tick's timestamp hasn't advanced past the
  // last push — satisfies Oracle's strictly-increasing requirement while flipping
  // the on-chain fresh flag. Uses max(lastPushed+1, wallClock) so that after a
  // service restart the synthetic always exceeds any previously pushed value.
  const currentTimeSec = BigInt(Math.floor(Date.now() / 1000));
  const timestamps = filteredTicks.map((t) => {
    const tickTsSec = BigInt(Math.floor(t.timestamp / 1000));
    const lastPushedSec = BigInt(Math.floor((lastPushedTimestamps[t.feedId] || 0) / 1000));
    if (tickTsSec > lastPushedSec) return tickTsSec;
    // Synthetic: use whichever is larger — handles restart where lastPushedSec
    // is 0 but on-chain has a previous synthetic from a prior run.
    const synthetic = lastPushedSec + 1n;
    return synthetic > currentTimeSec ? synthetic : currentTimeSec;
  });
  const freshFlags = filteredTicks.map((t) => t.fresh);

  let pushSucceeded = false;
  try {
    const signature = await signPriceBatch(feedIds, rawPrices, timestamps, freshFlags);

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
    // Timeout after 2 blocks to avoid hanging the pipeline if tx gets stuck.
    try {
      await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: config.blockTimeMs * 2,
      });
    } catch {
      // Receipt timeout — tx may still land later, proceed optimistically
      logger.warn("ChainPusher", `Receipt timeout for ${txHash}, continuing`);
    }
    pushSucceeded = true;
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("stale update")) {
      // On-chain already has this data — safe to run liquidation against current on-chain state
      logger.debug("ChainPusher", "Skipping: on-chain timestamps are current");
      pushSucceeded = true;
    } else if (msg.includes("already known")) {
      logger.debug("ChainPusher", "Skipping: tx already in mempool");
      pushSucceeded = true;
    } else if (msg.includes("replacement transaction underpriced")) {
      logger.debug("ChainPusher", "Skipping: nonce conflict (overlapping push)");
    } else {
      logger.warn("ChainPusher", `Push failed: ${msg.slice(0, 200)}`);
    }
  }

  // Always update timestamps to avoid re-attempting same data or same block.
  // Store max(tick ms, synthetic ms) so the ms-precision comparison on line 42
  // correctly rejects ticks whose timestamp hasn't truly advanced.
  lastChainPushAt = Date.now();
  hasEverPushed = true;
  for (let i = 0; i < filteredTicks.length; i++) {
    const syntheticMs = Number(timestamps[i]) * 1000;
    lastPushedTimestamps[filteredTicks[i].feedId] = Math.max(filteredTicks[i].timestamp, syntheticMs);
  }

  // Only update fresh flags when on-chain state reflects our intent.
  // If push failed, keep lastPushedFreshFlags unchanged so the one-shot
  // stale push can retry on the next cycle.
  if (pushSucceeded) {
    for (let i = 0; i < filteredTicks.length; i++) {
      lastPushedFreshFlags[filteredTicks[i].feedId] = filteredTicks[i].fresh;
    }
  }

  // Post-push hooks: liquidation (time-critical) first, fee accrual (non-critical) fire-and-forget
  if (pushSucceeded) {
    try {
      await checkAndLiquidateAll(filteredTicks);
    } catch (err) {
      logger.warn("ChainPusher", `Liquidation check error: ${(err as Error).message}`);
    }
  } else {
    logger.warn("ChainPusher", "Skipping liquidation check — on-chain price not confirmed current");
  }

  // Fee accrual runs concurrently — never blocks the liquidation path
  maybeTriggerAccrual().catch((err) =>
    logger.warn("ChainPusher", `Fee accrual error: ${(err as Error).message}`)
  );
}

/** Reset module-level state (for testing only) */
export function _resetChainPusherState(): void {
  lastPushedTimestamps = {};
  lastPushedFreshFlags = {};
  hasEverPushed = false;
  lastPushLogAt = 0;
  lastChainPushAt = 0;
}

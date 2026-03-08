import {
  createPublicClient,
  http,
  type Hex,
} from "viem";
import { config } from "../config/index.js";
import { getChain } from "../config/chains.js";
import { OracleABI } from "../abi/index.js";
import { getWalletClient, signPriceBatch } from "../utils/signing.js";
import { logger } from "../utils/logger.js";
import { maybeTriggerAccrual } from "../keepers/feeAccrualKeeper.js";
import { checkAndLiquidateAll } from "../keepers/liquidationEngine.js";
import type { PriceTick } from "../types/index.js";

let lastPushedTimestamps: Record<number, number> = {};
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

  // First push: include stale ticks so on-chain Oracle has data for MarketState
  // After that: only push fresh ticks
  const filteredTicks = ticks.filter(
    (t) => t.rawPrice > 0n && t.timestamp > (lastPushedTimestamps[t.feedId] || 0) && (t.fresh || !hasEverPushed)
  );
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
  const timestamps = filteredTicks.map((t) => BigInt(Math.floor(t.timestamp / 1000)));
  const freshFlags = filteredTicks.map((t) => t.fresh);

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

    const txHash = await walletClient.writeContract(request);
    logger.info("ChainPusher", `Prices pushed, tx: ${txHash}`);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("stale update")) {
      logger.debug("ChainPusher", "Skipping: on-chain timestamps are current");
    } else if (msg.includes("already known")) {
      logger.debug("ChainPusher", "Skipping: tx already in mempool");
    } else if (msg.includes("replacement transaction underpriced")) {
      logger.debug("ChainPusher", "Skipping: nonce conflict (overlapping push)");
    } else {
      logger.warn("ChainPusher", `Push failed: ${msg.slice(0, 200)}`);
    }
  }

  // Always update timestamps to avoid re-attempting same data or same block
  lastChainPushAt = Date.now();
  hasEverPushed = true;
  for (const tick of filteredTicks) {
    lastPushedTimestamps[tick.feedId] = tick.timestamp;
  }

  // Post-push hooks: fee accrual + liquidation (same tick)
  try {
    await maybeTriggerAccrual();
  } catch (err) {
    logger.warn("ChainPusher", `Fee accrual error: ${(err as Error).message}`);
  }

  try {
    await checkAndLiquidateAll(filteredTicks);
  } catch (err) {
    logger.warn("ChainPusher", `Liquidation check error: ${(err as Error).message}`);
  }
}

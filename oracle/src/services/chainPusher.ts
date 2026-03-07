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
import { retry } from "../utils/retry.js";
import { maybeTriggerAccrual } from "../keepers/feeAccrualKeeper.js";
import { checkAndLiquidateAll } from "../keepers/liquidationEngine.js";
import type { PriceTick } from "../types/index.js";

let lastPushedTimestamps: Record<number, number> = {};
let hasEverPushed = false;

/**
 * Push price ticks to the Oracle contract onchain
 */
export async function pushPrices(ticks: PriceTick[]): Promise<void> {
  if (!config.oracleAddress) {
    logger.warn("ChainPusher", "Oracle address not configured, skipping push");
    return;
  }

  // First push: include stale ticks so on-chain Oracle has data for MarketState
  // After that: only push fresh ticks
  const filteredTicks = ticks.filter(
    (t) => t.rawPrice > 0n && t.timestamp > (lastPushedTimestamps[t.feedId] || 0) && (t.fresh || !hasEverPushed)
  );
  if (filteredTicks.length === 0) return;

  const feedIds = filteredTicks.map((t) => t.feedId);
  const rawPrices = filteredTicks.map((t) => t.rawPrice);
  const timestamps = filteredTicks.map((t) => BigInt(Math.floor(t.timestamp / 1000)));
  const freshFlags = filteredTicks.map((t) => t.fresh);

  try {
    await retry(
      async () => {
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
      },
      3,
      1000,
      "pushPrices"
    );
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("stale update")) {
      // Prices already on-chain with same or newer timestamp — skip silently
      logger.debug("ChainPusher", "Skipping push: on-chain timestamps are current");
    } else {
      logger.error("ChainPusher", `Push failed: ${msg.slice(0, 200)}`);
    }
  }

  // Always update last pushed timestamps to avoid re-attempting same data
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

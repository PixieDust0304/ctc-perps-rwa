import {
  createPublicClient,
  http,
  type Hex,
} from "viem";
import { config } from "../config/index.js";
import { creditcoinLocal } from "../config/chains.js";
import { OracleABI } from "../abi/index.js";
import { getWalletClient, signPriceBatch } from "../utils/signing.js";
import { logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";
import { maybeTriggerAccrual } from "../keepers/feeAccrualKeeper.js";
import { checkAndLiquidateAll } from "../keepers/liquidationEngine.js";
import type { PriceTick } from "../types/index.js";

let lastPushedTimestamps: Record<number, number> = {};

/**
 * Push price ticks to the Oracle contract onchain
 */
export async function pushPrices(ticks: PriceTick[]): Promise<void> {
  if (!config.oracleAddress) {
    logger.warn("ChainPusher", "Oracle address not configured, skipping push");
    return;
  }

  // Filter to only push newer timestamps
  const filteredTicks = ticks.filter(
    (t) => t.timestamp > (lastPushedTimestamps[t.feedId] || 0)
  );
  if (filteredTicks.length === 0) return;

  const feedIds = filteredTicks.map((t) => t.feedId);
  const rawPrices = filteredTicks.map((t) => t.rawPrice);
  const timestamps = filteredTicks.map((t) => BigInt(t.timestamp));
  const freshFlags = filteredTicks.map((t) => t.fresh);

  await retry(
    async () => {
      const signature = await signPriceBatch(feedIds, rawPrices, timestamps, freshFlags);

      const walletClient = getWalletClient();
      const publicClient = createPublicClient({
        chain: creditcoinLocal,
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

      // Update last pushed timestamps
      for (const tick of filteredTicks) {
        lastPushedTimestamps[tick.feedId] = tick.timestamp;
      }
    },
    3,
    1000,
    "pushPrices"
  );

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

import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { creditcoinLocal } from "../config/chains.js";
import { P2PTradingABI, OracleABI, MarketStateABI } from "../abi/index.js";
import { getWalletClient } from "../utils/signing.js";
import { logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";
import { startSettlement, endSettlement } from "./keeperCoordinator.js";
import type { MarketStateUpdate } from "../types/index.js";

const BATCH_SIZE = 50;

/**
 * Handle market open: update MarketState, settle all P2P positions, sweep leftover
 */
export async function handleMarketOpenSettlement(updates: MarketStateUpdate[]): Promise<void> {
  for (const update of updates) {
    if (!update.isOpen) continue; // Only handle CLOSED→OPEN

    // Acquire settlement lock
    if (!startSettlement(update.feedId)) {
      logger.warn("P2PSettlement", `Settlement already running for feed ${update.feedId}`);
      continue;
    }

    try {
      // 1. Update MarketState contract
      await updateMarketStateOnChain(update.feedId);

      // 2. Settle all P2P positions
      if (config.p2pTradingAddress) {
        await settleAllP2PPositions(update.feedId);
      }
    } catch (err) {
      logger.error("P2PSettlement", `Settlement failed for feed ${update.feedId}: ${(err as Error).message}`);
    } finally {
      endSettlement(update.feedId);
    }
  }
}

async function updateMarketStateOnChain(feedId: number): Promise<void> {
  if (!config.marketStateAddress) return;

  await retry(
    async () => {
      const walletClient = getWalletClient();
      const publicClient = createPublicClient({
        chain: creditcoinLocal,
        transport: http(config.rpcUrl),
      });

      const { request } = await publicClient.simulateContract({
        address: config.marketStateAddress as Hex,
        abi: MarketStateABI,
        functionName: "updateState",
        args: [feedId],
        account: walletClient.account,
      });

      const txHash = await walletClient.writeContract(request);
      logger.info("P2PSettlement", `MarketState updated for feed ${feedId}, tx: ${txHash}`);
    },
    3,
    2000,
    "updateMarketState"
  );
}

async function settleAllP2PPositions(feedId: number): Promise<void> {
  const walletClient = getWalletClient();
  const publicClient = createPublicClient({
    chain: creditcoinLocal,
    transport: http(config.rpcUrl),
  });
  const p2pAddr = config.p2pTradingAddress as Hex;

  // Get total position count for this feed
  const count = (await publicClient.readContract({
    address: p2pAddr,
    abi: P2PTradingABI,
    functionName: "getFeedPositionCount",
    args: [feedId],
  })) as bigint;

  if (count === 0n) {
    logger.info("P2PSettlement", `No P2P positions to settle for feed ${feedId}`);
    return;
  }

  logger.info("P2PSettlement", `Settling ${count} P2P positions for feed ${feedId}`);

  // Read all position IDs
  const positionIds: Hex[] = [];
  for (let i = 0n; i < count; i++) {
    const posId = (await publicClient.readContract({
      address: p2pAddr,
      abi: P2PTradingABI,
      functionName: "feedPositionIds",
      args: [feedId, i],
    })) as Hex;
    positionIds.push(posId);
  }

  // Get current oracle price for settlement
  const priceData = (await publicClient.readContract({
    address: config.oracleAddress as Hex,
    abi: OracleABI,
    functionName: "getPrice",
    args: [feedId],
  })) as { price: bigint; timestamp: bigint; fresh: boolean };

  const settlementPrice = priceData.price;

  // Batch settle in chunks
  for (let i = 0; i < positionIds.length; i += BATCH_SIZE) {
    const batch = positionIds.slice(i, i + BATCH_SIZE);

    await retry(
      async () => {
        const { request } = await publicClient.simulateContract({
          address: p2pAddr,
          abi: P2PTradingABI,
          functionName: "settleP2PBatch",
          args: [batch, settlementPrice],
          account: walletClient.account,
        });

        const txHash = await walletClient.writeContract(request);
        logger.info(
          "P2PSettlement",
          `Settled batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} positions), tx: ${txHash}`
        );
      },
      3,
      2000,
      `settleP2PBatch-${feedId}`
    );
  }

  // Sweep leftover USDC
  try {
    const { request } = await publicClient.simulateContract({
      address: p2pAddr,
      abi: P2PTradingABI,
      functionName: "sweepLeftoverUSDC",
      args: [feedId],
      account: walletClient.account,
    });
    const txHash = await walletClient.writeContract(request);
    logger.info("P2PSettlement", `Swept leftover USDC for feed ${feedId}, tx: ${txHash}`);
  } catch (err) {
    logger.debug("P2PSettlement", `Sweep skipped for feed ${feedId}: ${(err as Error).message}`);
  }

  logger.info("P2PSettlement", `Settlement complete for feed ${feedId}`);
}

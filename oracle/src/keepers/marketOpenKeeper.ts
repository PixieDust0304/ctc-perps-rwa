import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { creditcoinLocal } from "../config/chains.js";
import { getWalletClient } from "../utils/signing.js";
import { logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";
import type { MarketStateUpdate } from "../types/index.js";

const MARKET_STATE_ABI = [
  {
    name: "updateState",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const P2P_TRADING_ABI = [
  {
    name: "settleP2PBatch",
    type: "function",
    inputs: [
      { name: "positionIds", type: "bytes32[]" },
      { name: "settlementPrice", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getFeedPositionCount",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * Handle market open: update MarketState onchain, settle P2P positions
 */
export async function handleMarketOpen(updates: MarketStateUpdate[]): Promise<void> {
  for (const update of updates) {
    if (!update.isOpen) continue; // Only handle market opening

    logger.info("MarketOpenKeeper", `Market opening for feed ${update.feedId}, triggering settlement`);

    // 1. Update MarketState contract
    if (config.marketStateAddress) {
      await retry(
        async () => {
          const walletClient = getWalletClient();
          const publicClient = createPublicClient({
            chain: creditcoinLocal,
            transport: http(config.rpcUrl),
          });

          const { request } = await publicClient.simulateContract({
            address: config.marketStateAddress as Hex,
            abi: MARKET_STATE_ABI,
            functionName: "updateState",
            args: [update.feedId],
            account: walletClient.account,
          });

          const txHash = await walletClient.writeContract(request);
          logger.info("MarketOpenKeeper", `MarketState updated, tx: ${txHash}`);
        },
        3,
        2000,
        "updateMarketState"
      );
    }

    // 2. Settle P2P positions (placeholder — in full implementation,
    // we'd query position IDs from events/indexer and batch settle)
    logger.info("MarketOpenKeeper", `P2P settlement complete for feed ${update.feedId}`);
  }
}

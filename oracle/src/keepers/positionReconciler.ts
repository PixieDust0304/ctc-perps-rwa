import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { getChain } from "../config/chains.js";
import { TradingABI, P2PTradingABI } from "../abi/index.js";
import { logger } from "../utils/logger.js";
import { getAllOpenPositionIds, updatePositionStatus, persistPosition, getPrisma, logKeeperEvent } from "../services/database.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const RECONCILE_BLOCK_LOOKBACK = BigInt(process.env.RECONCILE_BLOCK_LOOKBACK || "5000");

/**
 * Reconciliation sweep: verify DB open positions against on-chain state,
 * and scan recent blocks for any positions the DB missed.
 */
export async function reconcile(): Promise<void> {
  if (!getPrisma()) {
    logger.warn("Reconciler", "No DB available, skipping reconciliation");
    return;
  }

  logger.info("Reconciler", "Starting reconciliation sweep...");

  const client = createPublicClient({
    chain: getChain(),
    transport: http(config.rpcUrl),
  });

  let verified = 0;
  let fixed = 0;
  let discovered = 0;

  try {
    // Phase 1: Verify existing open positions in DB
    const openPositionIds = await getAllOpenPositionIds();

    // Pre-fetch close event logs so we can extract realizedPnl for stale positions
    const currentBlock = await client.getBlockNumber();
    const fromBlock = currentBlock > RECONCILE_BLOCK_LOOKBACK ? currentBlock - RECONCILE_BLOCK_LOOKBACK : 0n;

    // Build lookup maps: positionId -> { realizedPnl, txHash } from close events
    const tradingCloseMap = new Map<string, { realizedPnl: string; txHash: string }>();
    const p2pCloseMap = new Map<string, { realizedPnl: string; txHash: string }>();

    if (config.tradingAddress && openPositionIds.some(p => p.type === "trading")) {
      try {
        const closeLogs = await client.getLogs({
          address: config.tradingAddress as Hex,
          event: {
            type: "event",
            name: "PositionClosed",
            inputs: [
              { name: "positionId", type: "bytes32", indexed: true },
              { name: "realizedPnl", type: "int256", indexed: false },
            ],
          },
          fromBlock,
          toBlock: "latest",
        });
        for (const log of closeLogs) {
          const args = log.args as { positionId: Hex; realizedPnl: bigint };
          tradingCloseMap.set(args.positionId, {
            realizedPnl: args.realizedPnl.toString(),
            txHash: log.transactionHash ?? "",
          });
        }
      } catch {
        // Close event scan failed — reconciler will still close without PnL
      }
    }

    if (config.p2pTradingAddress && openPositionIds.some(p => p.type === "p2p")) {
      try {
        const closeLogs = await client.getLogs({
          address: config.p2pTradingAddress as Hex,
          event: {
            type: "event",
            name: "P2PPositionClosed",
            inputs: [
              { name: "positionId", type: "bytes32", indexed: true },
              { name: "realizedPnl", type: "int256", indexed: false },
            ],
          },
          fromBlock,
          toBlock: "latest",
        });
        for (const log of closeLogs) {
          const args = log.args as { positionId: Hex; realizedPnl: bigint };
          p2pCloseMap.set(args.positionId, {
            realizedPnl: args.realizedPnl.toString(),
            txHash: log.transactionHash ?? "",
          });
        }
      } catch {
        // Close event scan failed — reconciler will still close without PnL
      }
    }

    for (const { positionId, type } of openPositionIds) {
      try {
        if (type === "trading" && config.tradingAddress) {
          const result = await client.readContract({
            address: config.tradingAddress as Hex,
            abi: TradingABI,
            functionName: "getPosition",
            args: [positionId as Hex],
          });

          const data = result as { owner: Hex; collateral: bigint };
          if (data.owner === ZERO_ADDRESS || data.collateral === 0n) {
            const closeData = tradingCloseMap.get(positionId);
            await updatePositionStatus(
              positionId,
              "closed",
              closeData?.realizedPnl,
              closeData?.txHash || undefined,
            );
            fixed++;
            logger.info("Reconciler", `Fixed stale trading position: ${positionId}${closeData ? ` (PnL: ${closeData.realizedPnl})` : ""}`);
          } else {
            verified++;
          }
        } else if (type === "p2p" && config.p2pTradingAddress) {
          const result = await client.readContract({
            address: config.p2pTradingAddress as Hex,
            abi: P2PTradingABI,
            functionName: "positions",
            args: [positionId as Hex],
          });

          const data = result as { owner: Hex; collateral: bigint; isSettled: boolean };
          if (data.owner === ZERO_ADDRESS || data.collateral === 0n || data.isSettled) {
            const closeData = p2pCloseMap.get(positionId);
            await updatePositionStatus(
              positionId,
              "settled",
              closeData?.realizedPnl,
              closeData?.txHash || undefined,
            );
            fixed++;
            logger.info("Reconciler", `Fixed stale P2P position: ${positionId}${closeData ? ` (PnL: ${closeData.realizedPnl})` : ""}`);
          } else {
            verified++;
          }
        }
      } catch (err) {
        logger.warn("Reconciler", `Failed to verify position ${positionId}: ${(err as Error).message}`);
      }
    }

    // Phase 2: Scan recent blocks for missed positions
    const existingIds = new Set(openPositionIds.map((p) => p.positionId));

    // Scan trading events
    if (config.tradingAddress) {
      const recentOpened = await client.getLogs({
        address: config.tradingAddress as Hex,
        event: {
          type: "event",
          name: "PositionOpened",
          inputs: [
            { name: "positionId", type: "bytes32", indexed: true },
            { name: "owner", type: "address", indexed: true },
            { name: "feedId", type: "uint16", indexed: false },
            { name: "isLong", type: "bool", indexed: false },
            { name: "collateral", type: "uint256", indexed: false },
            { name: "sizeUsd", type: "uint256", indexed: false },
            { name: "entryPrice", type: "uint256", indexed: false },
          ],
        },
        fromBlock,
        toBlock: "latest",
      });

      for (const log of recentOpened) {
        const args = log.args as {
          positionId: Hex;
          owner: Hex;
          feedId: number;
          isLong: boolean;
          collateral: bigint;
          sizeUsd: bigint;
          entryPrice: bigint;
        };

        if (!existingIds.has(args.positionId)) {
          // Verify it's still open on-chain
          const onChain = (await client.readContract({
            address: config.tradingAddress as Hex,
            abi: TradingABI,
            functionName: "getPosition",
            args: [args.positionId],
          })) as { owner: Hex; collateral: bigint };

          if (onChain.owner !== ZERO_ADDRESS && onChain.collateral !== 0n) {
            await persistPosition({
              positionId: args.positionId,
              type: "trading",
              owner: args.owner,
              feedId: args.feedId,
              isLong: args.isLong,
              collateral: args.collateral.toString(),
              sizeUsd: args.sizeUsd.toString(),
              entryPrice: args.entryPrice.toString(),
              openedAt: new Date(),
              txHash: log.transactionHash ?? undefined,
            });
            discovered++;
            logger.info("Reconciler", `Discovered missed trading position: ${args.positionId}`);
          }
        }
      }
    }

    // Scan P2P events
    if (config.p2pTradingAddress) {
      const recentP2POpened = await client.getLogs({
        address: config.p2pTradingAddress as Hex,
        event: {
          type: "event",
          name: "P2PPositionOpened",
          inputs: [
            { name: "positionId", type: "bytes32", indexed: true },
            { name: "owner", type: "address", indexed: true },
            { name: "feedId", type: "uint16", indexed: false },
            { name: "isLong", type: "bool", indexed: false },
            { name: "collateral", type: "uint256", indexed: false },
            { name: "sizeUsd", type: "uint256", indexed: false },
            { name: "entryVammPrice", type: "uint256", indexed: false },
          ],
        },
        fromBlock,
        toBlock: "latest",
      });

      for (const log of recentP2POpened) {
        const args = log.args as {
          positionId: Hex;
          owner: Hex;
          feedId: number;
          isLong: boolean;
          collateral: bigint;
          sizeUsd: bigint;
          entryVammPrice: bigint;
        };

        if (!existingIds.has(args.positionId)) {
          const onChain = (await client.readContract({
            address: config.p2pTradingAddress as Hex,
            abi: P2PTradingABI,
            functionName: "positions",
            args: [args.positionId],
          })) as { owner: Hex; collateral: bigint; isSettled: boolean };

          if (onChain.owner !== ZERO_ADDRESS && onChain.collateral !== 0n && !onChain.isSettled) {
            await persistPosition({
              positionId: args.positionId,
              type: "p2p",
              owner: args.owner,
              feedId: args.feedId,
              isLong: args.isLong,
              collateral: args.collateral.toString(),
              sizeUsd: args.sizeUsd.toString(),
              entryPrice: args.entryVammPrice.toString(),
              openedAt: new Date(),
              txHash: log.transactionHash ?? undefined,
            });
            discovered++;
            logger.info("Reconciler", `Discovered missed P2P position: ${args.positionId}`);
          }
        }
      }
    }
  } catch (err) {
    logger.error("Reconciler", `Reconciliation error: ${(err as Error).message}`);
  }

  const summary = `Reconciliation complete: ${verified} verified, ${fixed} fixed, ${discovered} discovered`;
  logger.info("Reconciler", summary);

  await logKeeperEvent("reconciler", 0, "sweep", "N/A", null, "success", summary);
}

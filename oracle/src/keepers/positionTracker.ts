import { createPublicClient, http, type Hex, type Log } from "viem";
import { config } from "../config/index.js";
import { creditcoinLocal } from "../config/chains.js";
import { TradingABI } from "../abi/index.js";
import { logger } from "../utils/logger.js";
import type { Position } from "../types/index.js";

const openPositions = new Map<Hex, Position>();

let publicClient: ReturnType<typeof createPublicClient>;

function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: creditcoinLocal,
      transport: http(config.rpcUrl),
    });
  }
  return publicClient;
}

/**
 * Replay historical events from block 0 to build initial position state
 */
export async function replayHistoricalPositions(): Promise<void> {
  if (!config.tradingAddress) {
    logger.warn("PositionTracker", "Trading address not configured, skipping replay");
    return;
  }

  const client = getPublicClient();
  const tradingAddr = config.tradingAddress as Hex;

  logger.info("PositionTracker", "Replaying historical position events...");

  // Fetch PositionOpened events
  const openedLogs = await client.getLogs({
    address: tradingAddr,
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
    fromBlock: 0n,
    toBlock: "latest",
  });

  for (const log of openedLogs) {
    const args = log.args as {
      positionId: Hex;
      owner: Hex;
      feedId: number;
      isLong: boolean;
      collateral: bigint;
      sizeUsd: bigint;
      entryPrice: bigint;
    };
    addPositionFromEvent(args);
  }

  // Fetch PositionClosed events
  const closedLogs = await client.getLogs({
    address: tradingAddr,
    event: {
      type: "event",
      name: "PositionClosed",
      inputs: [
        { name: "positionId", type: "bytes32", indexed: true },
        { name: "owner", type: "address", indexed: true },
        { name: "realizedPnl", type: "int256", indexed: false },
      ],
    },
    fromBlock: 0n,
    toBlock: "latest",
  });

  for (const log of closedLogs) {
    const args = log.args as { positionId: Hex };
    removePosition(args.positionId);
  }

  // Fetch PositionLiquidated events
  const liquidatedLogs = await client.getLogs({
    address: tradingAddr,
    event: {
      type: "event",
      name: "PositionLiquidated",
      inputs: [
        { name: "positionId", type: "bytes32", indexed: true },
        { name: "owner", type: "address", indexed: true },
        { name: "liquidator", type: "address", indexed: false },
      ],
    },
    fromBlock: 0n,
    toBlock: "latest",
  });

  for (const log of liquidatedLogs) {
    const args = log.args as { positionId: Hex };
    removePosition(args.positionId);
  }

  logger.info("PositionTracker", `Replay complete. ${openPositions.size} open positions tracked.`);
}

/**
 * Start watching for real-time position events
 */
export function startWatching(): void {
  if (!config.tradingAddress) return;

  const client = getPublicClient();
  const tradingAddr = config.tradingAddress as Hex;

  client.watchContractEvent({
    address: tradingAddr,
    abi: TradingABI,
    eventName: "PositionOpened",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = log.args as {
          positionId: Hex;
          owner: Hex;
          feedId: number;
          isLong: boolean;
          collateral: bigint;
          sizeUsd: bigint;
          entryPrice: bigint;
        };
        addPositionFromEvent(args);
        logger.info("PositionTracker", `Position opened: ${args.positionId} feed=${args.feedId}`);
      }
    },
  });

  client.watchContractEvent({
    address: tradingAddr,
    abi: TradingABI,
    eventName: "PositionClosed",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = log.args as { positionId: Hex };
        removePosition(args.positionId);
        logger.info("PositionTracker", `Position closed: ${args.positionId}`);
      }
    },
  });

  client.watchContractEvent({
    address: tradingAddr,
    abi: TradingABI,
    eventName: "PositionLiquidated",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = log.args as { positionId: Hex };
        removePosition(args.positionId);
        logger.info("PositionTracker", `Position liquidated: ${args.positionId}`);
      }
    },
  });

  logger.info("PositionTracker", "Watching for real-time position events");
}

function addPositionFromEvent(args: {
  positionId: Hex;
  owner: Hex;
  feedId: number;
  isLong: boolean;
  collateral: bigint;
  sizeUsd: bigint;
  entryPrice: bigint;
}): void {
  // We need fee snapshots from the contract for accurate pre-check.
  // On replay, we fetch them lazily on first liquidation check.
  // For real-time, the event data is enough to track; snapshots are fetched when needed.
  openPositions.set(args.positionId, {
    id: args.positionId,
    owner: args.owner,
    feedId: args.feedId,
    isLong: args.isLong,
    collateral: args.collateral,
    sizeUsd: args.sizeUsd,
    entryPrice: args.entryPrice,
    openTimestamp: 0n, // populated on-demand
    cumulativeBaseFeeSnapshot: 0n, // populated on-demand
    cumulativeFundingSnapshot: 0n, // populated on-demand
  });
}

/**
 * Enrich a position with on-chain fee snapshots (called lazily before liquidation check)
 */
export async function enrichPosition(positionId: Hex): Promise<Position | undefined> {
  const pos = openPositions.get(positionId);
  if (!pos) return undefined;

  // If already enriched (non-zero openTimestamp), skip
  if (pos.openTimestamp !== 0n) return pos;

  try {
    const client = getPublicClient();
    const result = await client.readContract({
      address: config.tradingAddress as Hex,
      abi: TradingABI,
      functionName: "getPosition",
      args: [positionId],
    });

    const data = result as {
      owner: Hex;
      feedId: number;
      isLong: boolean;
      collateral: bigint;
      sizeUsd: bigint;
      entryPrice: bigint;
      openTimestamp: bigint;
      cumulativeBaseFeeSnapshot: bigint;
      cumulativeFundingSnapshot: bigint;
    };

    // Position has been closed on-chain (owner is zero address)
    if (data.owner === "0x0000000000000000000000000000000000000000") {
      openPositions.delete(positionId);
      return undefined;
    }

    pos.openTimestamp = data.openTimestamp;
    pos.cumulativeBaseFeeSnapshot = data.cumulativeBaseFeeSnapshot;
    pos.cumulativeFundingSnapshot = data.cumulativeFundingSnapshot;
    return pos;
  } catch (err) {
    logger.warn("PositionTracker", `Failed to enrich position ${positionId}: ${(err as Error).message}`);
    return pos;
  }
}

function removePosition(positionId: Hex): void {
  openPositions.delete(positionId);
}

export function getOpenPositions(feedId?: number): Position[] {
  const all = Array.from(openPositions.values());
  if (feedId === undefined) return all;
  return all.filter((p) => p.feedId === feedId);
}

export function getPositionCount(): number {
  return openPositions.size;
}

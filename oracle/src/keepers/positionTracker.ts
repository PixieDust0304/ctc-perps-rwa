import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { getChain } from "../config/chains.js";
import { TradingABI, P2PTradingABI, VAMMABI } from "../abi/index.js";
import { logger } from "../utils/logger.js";
import { getPrisma, persistPosition, updatePositionStatus, updatePositionCollateral, queryPositionsByType } from "../services/database.js";
import { broadcastPositionUpdate, broadcastVammPrices } from "../services/websocketServer.js";
import { storePriceTicks } from "../services/priceStore.js";
import type { Position, P2PPosition } from "../types/index.js";

/**
 * Safely convert a Prisma Decimal (or any numeric-like value) to BigInt
 * without stripping trailing zeros.
 */
function decimalToBigInt(val: unknown): bigint {
  const s = String(val);
  // Strip decimal point and any fractional digits (Prisma Decimals store integers as "12345.0")
  const dotIdx = s.indexOf(".");
  const intPart = dotIdx >= 0 ? s.slice(0, dotIdx) : s;
  if (!intPart || intPart === "-") return 0n;
  return BigInt(intPart);
}

async function emitVammPrice(feedId: number): Promise<void> {
  if (!config.vammAddress) return;
  try {
    const client = getPublicClient();
    const vammPrice = await client.readContract({
      address: config.vammAddress as Hex,
      abi: VAMMABI,
      functionName: "getVAMMPrice",
      args: [feedId],
    }) as bigint;
    const now = Date.now();
    // Broadcast for live WebSocket clients
    broadcastVammPrices([{ feedId, price: vammPrice.toString(), timestamp: now }]);
    // Persist to DB + candles so VAMM price movements survive page changes
    storePriceTicks([{
      feedId,
      price: vammPrice,
      rawPrice: vammPrice,
      timestamp: now,
      fresh: false,
      source: "vamm",
    }]);
  } catch {
    // VAMM not active or read failed
  }
}

const openPositions = new Map<Hex, Position>();
const openP2PPositions = new Map<Hex, P2PPosition>();

let publicClient: ReturnType<typeof createPublicClient>;

function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: getChain(),
      transport: http(config.rpcUrl),
      pollingInterval: config.blockTimeMs,
    });
  }
  return publicClient;
}

function serializePosition(pos: Position | P2PPosition): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pos)) {
    result[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return result;
}

/**
 * Initialize positions — from DB if available, else replay from chain
 */
export async function initPositions(): Promise<void> {
  const prisma = getPrisma();

  if (prisma) {
    try {
      // Load trading positions from DB
      const tradingRows = await queryPositionsByType("trading", undefined, "open");
      for (const row of tradingRows) {
        const id = row.positionId as Hex;
        openPositions.set(id, {
          id,
          owner: row.owner as `0x${string}`,
          feedId: row.feedId,
          isLong: row.isLong,
          collateral: decimalToBigInt(row.collateral),
          sizeUsd: decimalToBigInt(row.sizeUsd),
          entryPrice: decimalToBigInt(row.entryPrice),
          openTimestamp: 0n,
          cumulativeBaseFeeSnapshot: 0n,
          cumulativeFundingSnapshot: 0n,
        });
      }

      // Load P2P positions from DB
      const p2pRows = await queryPositionsByType("p2p", undefined, "open");
      for (const row of p2pRows) {
        const id = row.positionId as Hex;
        openP2PPositions.set(id, {
          id,
          owner: row.owner as `0x${string}`,
          feedId: row.feedId,
          isLong: row.isLong,
          collateral: decimalToBigInt(row.collateral),
          sizeUsd: decimalToBigInt(row.sizeUsd),
          entryPrice: decimalToBigInt(row.entryPrice),
          openTimestamp: 0n,
          isSettled: false,
        });
      }

      logger.info("PositionTracker", `Loaded ${openPositions.size} trading + ${openP2PPositions.size} P2P positions from DB`);
      return;
    } catch (err) {
      logger.warn("PositionTracker", `DB load failed, falling back to chain replay: ${err}`);
    }
  }

  // Fallback: replay from chain (may timeout on CTC testnet with large block ranges)
  try {
    await replayHistoricalPositions();
  } catch (err) {
    logger.warn("PositionTracker", `Chain replay failed (reconciler will backfill): ${(err as Error).message.slice(0, 200)}`);
  }
}

/**
 * Replay historical events from block 0 to build initial position state
 */
async function replayHistoricalPositions(): Promise<void> {
  if (!config.tradingAddress) {
    logger.warn("PositionTracker", "Trading address not configured, skipping replay");
    return;
  }

  const client = getPublicClient();
  const tradingAddr = config.tradingAddress as Hex;

  logger.info("PositionTracker", "Replaying historical position events...");

  // Trading: PositionOpened
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
    addTradingPosition(args, log.transactionHash);
  }

  // Trading: PositionClosed
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
    const args = log.args as { positionId: Hex; realizedPnl: bigint };
    openPositions.delete(args.positionId);
  }

  // Trading: PositionLiquidated
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
    openPositions.delete(args.positionId);
  }

  // P2P replay
  if (config.p2pTradingAddress) {
    await replayP2PPositions();
  }

  logger.info("PositionTracker", `Replay complete. ${openPositions.size} trading + ${openP2PPositions.size} P2P positions tracked.`);
}

async function replayP2PPositions(): Promise<void> {
  const client = getPublicClient();
  const p2pAddr = config.p2pTradingAddress as Hex;

  const openedLogs = await client.getLogs({
    address: p2pAddr,
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
      entryVammPrice: bigint;
    };
    addP2PPosition(args, log.transactionHash);
  }

  // P2P: closed
  const closedLogs = await client.getLogs({
    address: p2pAddr,
    event: {
      type: "event",
      name: "P2PPositionClosed",
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
    openP2PPositions.delete(args.positionId);
  }

  // P2P: batch settled — remove all positions for the feed
  const settledLogs = await client.getLogs({
    address: p2pAddr,
    event: {
      type: "event",
      name: "P2PBatchSettled",
      inputs: [
        { name: "feedId", type: "uint16", indexed: true },
        { name: "settledCount", type: "uint256", indexed: false },
        { name: "settlementPrice", type: "uint256", indexed: false },
      ],
    },
    fromBlock: 0n,
    toBlock: "latest",
  });

  for (const log of settledLogs) {
    const args = log.args as { feedId: number };
    for (const [id, pos] of openP2PPositions) {
      if (pos.feedId === args.feedId) {
        openP2PPositions.delete(id);
      }
    }
  }
}

function addTradingPosition(
  args: {
    positionId: Hex;
    owner: Hex;
    feedId: number;
    isLong: boolean;
    collateral: bigint;
    sizeUsd: bigint;
    entryPrice: bigint;
  },
  txHash?: Hex | null
): void {
  openPositions.set(args.positionId, {
    id: args.positionId,
    owner: args.owner,
    feedId: args.feedId,
    isLong: args.isLong,
    collateral: args.collateral,
    sizeUsd: args.sizeUsd,
    entryPrice: args.entryPrice,
    openTimestamp: 0n,
    cumulativeBaseFeeSnapshot: 0n,
    cumulativeFundingSnapshot: 0n,
  });

  // Eagerly enrich so liquidation engine never hits a cold cache
  enrichPosition(args.positionId).catch(() => {});

  persistPosition({
    positionId: args.positionId,
    type: "trading",
    owner: args.owner,
    feedId: args.feedId,
    isLong: args.isLong,
    collateral: args.collateral.toString(),
    sizeUsd: args.sizeUsd.toString(),
    entryPrice: args.entryPrice.toString(),
    openedAt: new Date(),
    txHash: txHash ?? undefined,
  });
}

function addP2PPosition(
  args: {
    positionId: Hex;
    owner: Hex;
    feedId: number;
    isLong: boolean;
    collateral: bigint;
    sizeUsd: bigint;
    entryVammPrice: bigint;
  },
  txHash?: Hex | null
): void {
  openP2PPositions.set(args.positionId, {
    id: args.positionId,
    owner: args.owner,
    feedId: args.feedId,
    isLong: args.isLong,
    collateral: args.collateral,
    sizeUsd: args.sizeUsd,
    entryPrice: args.entryVammPrice,
    openTimestamp: 0n,
    isSettled: false,
  });

  persistPosition({
    positionId: args.positionId,
    type: "p2p",
    owner: args.owner,
    feedId: args.feedId,
    isLong: args.isLong,
    collateral: args.collateral.toString(),
    sizeUsd: args.sizeUsd.toString(),
    entryPrice: args.entryVammPrice.toString(),
    openedAt: new Date(),
    txHash: txHash ?? undefined,
  });
}

/**
 * Start watching for real-time position events (Trading + P2P)
 */
export function startWatching(): void {
  const client = getPublicClient();

  // Trading watchers
  if (config.tradingAddress) {
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
          addTradingPosition(args, log.transactionHash);
          const pos = openPositions.get(args.positionId)!;
          broadcastPositionUpdate("opened", "trading", serializePosition(pos));
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
          const args = log.args as { positionId: Hex; realizedPnl: bigint };
          // Guard: only process closes for tracked positions (matches log polling behavior).
          // CTC drops eth_newFilter filters, so stale/garbled events can arrive here.
          if (!openPositions.has(args.positionId)) continue;
          const pos = openPositions.get(args.positionId);
          openPositions.delete(args.positionId);
          updatePositionStatus(args.positionId, "closed", args.realizedPnl?.toString(), log.transactionHash ?? undefined);
          broadcastPositionUpdate("closed", "trading", {
            positionId: args.positionId,
            realizedPnl: args.realizedPnl?.toString(),
            ...(pos ? serializePosition(pos) : {}),
          });
          logger.info("PositionTracker", `Position closed: ${args.positionId}`);
        }
      },
    });

    client.watchContractEvent({
      address: tradingAddr,
      abi: TradingABI,
      eventName: "CollateralAdded",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            positionId: Hex;
            owner: Hex;
            amount: bigint;
            newCollateral: bigint;
          };
          const pos = openPositions.get(args.positionId);
          if (pos) {
            pos.collateral = args.newCollateral;
          }
          updatePositionCollateral(args.positionId, args.newCollateral.toString());
          broadcastPositionUpdate("collateralAdded", "trading", {
            positionId: args.positionId,
            owner: args.owner,
            amount: args.amount?.toString(),
            newCollateral: args.newCollateral?.toString(),
            ...(pos ? serializePosition(pos) : {}),
          });
          logger.info("PositionTracker", `Collateral added to ${args.positionId}: +${args.amount}`);
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
          if (!openPositions.has(args.positionId)) continue;
          const pos = openPositions.get(args.positionId);
          openPositions.delete(args.positionId);
          // PositionLiquidated doesn't emit realizedPnl — trader loses entire collateral
          const realizedPnl = pos ? (-pos.collateral).toString() : undefined;
          updatePositionStatus(args.positionId, "liquidated", realizedPnl, log.transactionHash ?? undefined);
          broadcastPositionUpdate("liquidated", "trading", {
            positionId: args.positionId,
            realizedPnl,
            ...(pos ? serializePosition(pos) : {}),
          });
          logger.info("PositionTracker", `Position liquidated: ${args.positionId}${realizedPnl ? ` (PnL: ${realizedPnl})` : ""}`);
        }
      },
    });
  }

  // P2P watchers
  if (config.p2pTradingAddress) {
    const p2pAddr = config.p2pTradingAddress as Hex;

    client.watchContractEvent({
      address: p2pAddr,
      abi: P2PTradingABI,
      eventName: "P2PPositionOpened",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as {
            positionId: Hex;
            owner: Hex;
            feedId: number;
            isLong: boolean;
            collateral: bigint;
            sizeUsd: bigint;
            entryVammPrice: bigint;
          };
          addP2PPosition(args, log.transactionHash);
          const pos = openP2PPositions.get(args.positionId)!;
          broadcastPositionUpdate("opened", "p2p", serializePosition(pos));
          emitVammPrice(args.feedId);
          logger.info("PositionTracker", `P2P position opened: ${args.positionId} feed=${args.feedId}`);
        }
      },
    });

    client.watchContractEvent({
      address: p2pAddr,
      abi: P2PTradingABI,
      eventName: "P2PPositionClosed",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as { positionId: Hex; realizedPnl: bigint };
          const pos = openP2PPositions.get(args.positionId);
          const closedFeedId = pos?.feedId;
          openP2PPositions.delete(args.positionId);
          updatePositionStatus(args.positionId, "settled", args.realizedPnl?.toString(), log.transactionHash ?? undefined);
          broadcastPositionUpdate("settled", "p2p", {
            positionId: args.positionId,
            realizedPnl: args.realizedPnl?.toString(),
            ...(pos ? serializePosition(pos) : {}),
          });
          if (closedFeedId !== undefined) emitVammPrice(closedFeedId);
          logger.info("PositionTracker", `P2P position closed: ${args.positionId}`);
        }
      },
    });

    client.watchContractEvent({
      address: p2pAddr,
      abi: P2PTradingABI,
      eventName: "P2PBatchSettled",
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as { feedId: number; settledCount: bigint; settlementPrice: bigint };
          // Remove all P2P positions for this feed
          for (const [id, pos] of openP2PPositions) {
            if (pos.feedId === args.feedId) {
              openP2PPositions.delete(id);
              updatePositionStatus(id, "settled");
            }
          }
          broadcastPositionUpdate("settled", "p2p", {
            feedId: args.feedId,
            settledCount: args.settledCount?.toString(),
            settlementPrice: args.settlementPrice?.toString(),
          });
          logger.info("PositionTracker", `P2P batch settled: feed=${args.feedId} count=${args.settledCount}`);
        }
      },
    });
  }

  logger.info("PositionTracker", "Watching for real-time position events (Trading + P2P)");

  // Start getLogs-based polling fallback (CTC drops eth_newFilter filters in ~5s)
  startLogPolling();
}

// Aggressive polling — getBlockNumber is cheap, getLogs only fires when a new block exists.
// On slow chains (15s blocks): 4 no-ops + 1 real poll per block. Fast position detection.
const LOG_POLL_INTERVAL = 3_000;
let lastProcessedBlock = 0n;
let pollInitialized = false;

function startLogPolling(): void {
  const client = getPublicClient();

  logger.info("PositionTracker", `Log polling fallback scheduled (${LOG_POLL_INTERVAL / 1000}s interval)`);

  const poll = async () => {
    try {
      const currentBlock = await client.getBlockNumber();

      if (!pollInitialized) {
        lastProcessedBlock = currentBlock;
        pollInitialized = true;
        logger.info("PositionTracker", `Log polling initialized at block ${currentBlock}`);
        return;
      }

      if (currentBlock <= lastProcessedBlock) return;

      const fromBlock = lastProcessedBlock + 1n;
      const toBlock = currentBlock;

      // Trading events
      if (config.tradingAddress) {
        const tradingAddr = config.tradingAddress as Hex;

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
          fromBlock,
          toBlock,
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
          if (openPositions.has(args.positionId)) continue;
          addTradingPosition(args, log.transactionHash);
          // addTradingPosition already triggers eager enrichment
          const pos = openPositions.get(args.positionId)!;
          broadcastPositionUpdate("opened", "trading", serializePosition(pos));
          logger.info("PositionTracker", `[poll] Position opened: ${args.positionId} feed=${args.feedId}`);
        }

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
          fromBlock,
          toBlock,
        });

        for (const log of closedLogs) {
          const args = log.args as { positionId: Hex; realizedPnl: bigint };
          if (!openPositions.has(args.positionId)) continue;
          const pos = openPositions.get(args.positionId);
          openPositions.delete(args.positionId);
          updatePositionStatus(args.positionId, "closed", args.realizedPnl?.toString(), log.transactionHash ?? undefined);
          broadcastPositionUpdate("closed", "trading", {
            positionId: args.positionId,
            realizedPnl: args.realizedPnl?.toString(),
            ...(pos ? serializePosition(pos) : {}),
          });
          logger.info("PositionTracker", `[poll] Position closed: ${args.positionId}`);
        }

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
          fromBlock,
          toBlock,
        });

        for (const log of liquidatedLogs) {
          const args = log.args as { positionId: Hex };
          if (!openPositions.has(args.positionId)) continue;
          const pos = openPositions.get(args.positionId);
          openPositions.delete(args.positionId);
          // PositionLiquidated doesn't emit realizedPnl — trader loses entire collateral
          const realizedPnl = pos ? (-pos.collateral).toString() : undefined;
          updatePositionStatus(args.positionId, "liquidated", realizedPnl, log.transactionHash ?? undefined);
          broadcastPositionUpdate("liquidated", "trading", {
            positionId: args.positionId,
            realizedPnl,
            ...(pos ? serializePosition(pos) : {}),
          });
          logger.info("PositionTracker", `[poll] Position liquidated: ${args.positionId}${realizedPnl ? ` (PnL: ${realizedPnl})` : ""}`);
        }

        const collateralLogs = await client.getLogs({
          address: tradingAddr,
          event: {
            type: "event",
            name: "CollateralAdded",
            inputs: [
              { name: "positionId", type: "bytes32", indexed: true },
              { name: "owner", type: "address", indexed: true },
              { name: "amount", type: "uint256", indexed: false },
              { name: "newCollateral", type: "uint256", indexed: false },
            ],
          },
          fromBlock,
          toBlock,
        });

        for (const log of collateralLogs) {
          const args = log.args as {
            positionId: Hex;
            owner: Hex;
            amount: bigint;
            newCollateral: bigint;
          };
          const pos = openPositions.get(args.positionId);
          if (pos) {
            pos.collateral = args.newCollateral;
          }
          updatePositionCollateral(args.positionId, args.newCollateral.toString());
          broadcastPositionUpdate("collateralAdded", "trading", {
            positionId: args.positionId,
            owner: args.owner,
            amount: args.amount?.toString(),
            newCollateral: args.newCollateral?.toString(),
            ...(pos ? serializePosition(pos) : {}),
          });
          logger.info("PositionTracker", `[poll] Collateral added to ${args.positionId}: +${args.amount}`);
        }
      }

      // P2P events
      if (config.p2pTradingAddress) {
        const p2pAddr = config.p2pTradingAddress as Hex;

        const p2pOpenedLogs = await client.getLogs({
          address: p2pAddr,
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
          toBlock,
        });

        for (const log of p2pOpenedLogs) {
          const args = log.args as {
            positionId: Hex;
            owner: Hex;
            feedId: number;
            isLong: boolean;
            collateral: bigint;
            sizeUsd: bigint;
            entryVammPrice: bigint;
          };
          if (openP2PPositions.has(args.positionId)) continue;
          addP2PPosition(args, log.transactionHash);
          const pos = openP2PPositions.get(args.positionId)!;
          broadcastPositionUpdate("opened", "p2p", serializePosition(pos));
          emitVammPrice(args.feedId);
          logger.info("PositionTracker", `[poll] P2P position opened: ${args.positionId} feed=${args.feedId}`);
        }

        const p2pClosedLogs = await client.getLogs({
          address: p2pAddr,
          event: {
            type: "event",
            name: "P2PPositionClosed",
            inputs: [
              { name: "positionId", type: "bytes32", indexed: true },
              { name: "owner", type: "address", indexed: true },
              { name: "realizedPnl", type: "int256", indexed: false },
            ],
          },
          fromBlock,
          toBlock,
        });

        for (const log of p2pClosedLogs) {
          const args = log.args as { positionId: Hex; realizedPnl: bigint };
          if (!openP2PPositions.has(args.positionId)) continue;
          const pos = openP2PPositions.get(args.positionId);
          const closedFeedId = pos?.feedId;
          openP2PPositions.delete(args.positionId);
          updatePositionStatus(args.positionId, "settled", args.realizedPnl?.toString(), log.transactionHash ?? undefined);
          broadcastPositionUpdate("settled", "p2p", {
            positionId: args.positionId,
            realizedPnl: args.realizedPnl?.toString(),
            ...(pos ? serializePosition(pos) : {}),
          });
          if (closedFeedId !== undefined) emitVammPrice(closedFeedId);
          logger.info("PositionTracker", `[poll] P2P position closed: ${args.positionId}`);
        }

        const batchSettledLogs = await client.getLogs({
          address: p2pAddr,
          event: {
            type: "event",
            name: "P2PBatchSettled",
            inputs: [
              { name: "feedId", type: "uint16", indexed: true },
              { name: "settledCount", type: "uint256", indexed: false },
              { name: "settlementPrice", type: "uint256", indexed: false },
            ],
          },
          fromBlock,
          toBlock,
        });

        for (const log of batchSettledLogs) {
          const args = log.args as { feedId: number; settledCount: bigint; settlementPrice: bigint };
          let hadPositions = false;
          for (const [id, pos] of openP2PPositions) {
            if (pos.feedId === args.feedId) {
              openP2PPositions.delete(id);
              updatePositionStatus(id, "settled");
              hadPositions = true;
            }
          }
          if (hadPositions) {
            broadcastPositionUpdate("settled", "p2p", {
              feedId: args.feedId,
              settledCount: args.settledCount?.toString(),
              settlementPrice: args.settlementPrice?.toString(),
            });
            logger.info("PositionTracker", `[poll] P2P batch settled: feed=${args.feedId} count=${args.settledCount}`);
          }
        }
      }

      lastProcessedBlock = toBlock;
    } catch (err) {
      logger.warn("PositionTracker", `Log polling error: ${(err as Error).message}`);
    }
  };

  setInterval(poll, LOG_POLL_INTERVAL);
}

/**
 * Enrich a position with on-chain fee snapshots (called lazily before liquidation check)
 */
export async function enrichPosition(positionId: Hex): Promise<Position | undefined> {
  const pos = openPositions.get(positionId);
  if (!pos) return undefined;

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

    if (data.owner === "0x0000000000000000000000000000000000000000") {
      openPositions.delete(positionId);
      return undefined;
    }

    // Update ALL fields from on-chain data (also fixes DB-loaded positions with stale/corrupted values)
    pos.collateral = data.collateral;
    pos.sizeUsd = data.sizeUsd;
    pos.entryPrice = data.entryPrice;
    pos.openTimestamp = data.openTimestamp;
    pos.cumulativeBaseFeeSnapshot = data.cumulativeBaseFeeSnapshot;
    pos.cumulativeFundingSnapshot = data.cumulativeFundingSnapshot;
    return pos;
  } catch (err) {
    logger.warn("PositionTracker", `Failed to enrich position ${positionId}: ${(err as Error).message}`);
    return pos;
  }
}

/**
 * Ensure a trading position is tracked in the in-memory map (called by reconciler to backfill).
 * Returns true if the position was newly added.
 */
export function ensureTracked(positionId: Hex, pos: {
  owner: Hex;
  feedId: number;
  isLong: boolean;
  collateral: bigint;
  sizeUsd: bigint;
  entryPrice: bigint;
}): boolean {
  if (openPositions.has(positionId)) return false;
  openPositions.set(positionId, {
    id: positionId,
    owner: pos.owner,
    feedId: pos.feedId,
    isLong: pos.isLong,
    collateral: pos.collateral,
    sizeUsd: pos.sizeUsd,
    entryPrice: pos.entryPrice,
    openTimestamp: 0n,
    cumulativeBaseFeeSnapshot: 0n,
    cumulativeFundingSnapshot: 0n,
  });
  return true;
}

export function getOpenPositions(feedId?: number): Position[] {
  const all = Array.from(openPositions.values());
  if (feedId === undefined) return all;
  return all.filter((p) => p.feedId === feedId);
}

export function getOpenP2PPositions(feedId?: number): P2PPosition[] {
  const all = Array.from(openP2PPositions.values());
  if (feedId === undefined) return all;
  return all.filter((p) => p.feedId === feedId);
}

export function getPositionsForOwner(owner: string): Position[] {
  const lc = owner.toLowerCase();
  return Array.from(openPositions.values()).filter((p) => p.owner.toLowerCase() === lc);
}

export function getP2PPositionsForOwner(owner: string): P2PPosition[] {
  const lc = owner.toLowerCase();
  return Array.from(openP2PPositions.values()).filter((p) => p.owner.toLowerCase() === lc);
}

export function getPositionCount(): number {
  return openPositions.size;
}

export function getP2PPositionCount(): number {
  return openP2PPositions.size;
}

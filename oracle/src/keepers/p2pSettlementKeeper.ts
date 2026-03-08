import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { getChain } from "../config/chains.js";
import { P2PTradingABI, OracleABI, MarketStateABI, VAMMABI, CustodyABI } from "../abi/index.js";
import { getWalletClient } from "../utils/signing.js";
import { getLatestPrice } from "../services/priceStore.js";
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
    const feedName = config.feedNames?.[update.feedId] || `Feed ${update.feedId}`;
    const direction = update.isOpen ? "CLOSED→OPEN" : "OPEN→CLOSED";
    logger.info("P2PSettlement", `*** ${feedName} transition: ${direction} — starting settlement ***`);

    // Acquire settlement lock
    if (!startSettlement(update.feedId)) {
      logger.warn("P2PSettlement", `Settlement already running for ${feedName}, skipping`);
      continue;
    }

    try {
      if (update.isOpen) {
        // CLOSED→OPEN: deactivate VAMM, update MarketState, settle P2P positions
        // Each step is independent — one failure must not block the others
        logger.info("P2PSettlement", `${feedName}: Step 1/3 — Deactivating VAMM`);
        try { await deactivateVAMMForFeed(update.feedId); } catch (err) {
          logger.warn("P2PSettlement", `${feedName}: VAMM deactivation failed: ${(err as Error).message}`);
        }
        logger.info("P2PSettlement", `${feedName}: Step 2/3 — Updating MarketState on-chain`);
        await updateMarketStateOnChain(update.feedId);
        if (config.p2pTradingAddress) {
          logger.info("P2PSettlement", `${feedName}: Step 3/3 — Settling P2P positions`);
          await settleAllP2PPositions(update.feedId);
        }
        logger.info("P2PSettlement", `${feedName}: CLOSED→OPEN settlement complete`);
      } else {
        // OPEN→CLOSED: initialize VAMM with last known price for P2P trading
        logger.info("P2PSettlement", `${feedName}: Step 1/2 — Initializing VAMM`);
        try { await initializeVAMMForFeed(update.feedId); } catch (err) {
          logger.warn("P2PSettlement", `${feedName}: VAMM initialization failed: ${(err as Error).message}`);
        }
        logger.info("P2PSettlement", `${feedName}: Step 2/2 — Updating MarketState on-chain`);
        await updateMarketStateOnChain(update.feedId);
        logger.info("P2PSettlement", `${feedName}: OPEN→CLOSED settlement complete`);
      }
    } catch (err) {
      logger.error("P2PSettlement", `${feedName}: Settlement FAILED: ${(err as Error).message}`);
    } finally {
      endSettlement(update.feedId);
    }
  }
}

async function initializeVAMMForFeed(feedId: number): Promise<void> {
  if (!config.vammAddress) return;

  const lastPrice = getLatestPrice(feedId);
  if (!lastPrice || lastPrice.price === 0n) {
    logger.warn("P2PSettlement", `No price available to initialize VAMM for feed ${feedId}`);
    return;
  }

  // Check if VAMM is already active (e.g. deploy script already initialized it)
  try {
    const publicClient = createPublicClient({
      chain: getChain(),
      transport: http(config.rpcUrl),
    });
    const vammState = await publicClient.readContract({
      address: config.vammAddress as Hex,
      abi: VAMMABI,
      functionName: "vamms",
      args: [feedId],
    }) as [bigint, bigint, bigint, bigint, boolean];
    if (vammState[4]) {
      logger.info("P2PSettlement", `VAMM already active for feed ${feedId}, skipping initialization`);
      return;
    }
  } catch {
    // Read failed — proceed with initialization attempt
  }

  // Dynamic depth: read custody LP liquidity, calculate depth = max(lpLiq * bps / 10000, minDepth)
  const custodyAddr = config.custodyAddresses[feedId];
  if (custodyAddr) {
    try {
      const publicClient = createPublicClient({
        chain: getChain(),
        transport: http(config.rpcUrl),
      });
      const lpLiq = await publicClient.readContract({
        address: custodyAddr as Hex,
        abi: CustodyABI,
        functionName: "lpLiquidity",
      }) as bigint;
      const minDepth = BigInt(config.vammMinDepth);
      const calculatedDepth = lpLiq * BigInt(config.vammDepthBps) / 10000n;
      const depth = calculatedDepth > minDepth ? calculatedDepth : minDepth;

      const walletClient = getWalletClient();
      const { request } = await publicClient.simulateContract({
        address: config.vammAddress as Hex,
        abi: VAMMABI,
        functionName: "setDepthMultiplier",
        args: [feedId, depth],
        account: walletClient.account,
      });
      const txHash = await walletClient.writeContract(request);
      logger.info("P2PSettlement", `VAMM depth set for feed ${feedId}: $${Number(depth) / 1e18} (lpLiq=$${Number(lpLiq) / 1e18}), tx: ${txHash}`);
    } catch (err) {
      logger.warn("P2PSettlement", `Dynamic depth failed for feed ${feedId}, using existing: ${(err as Error).message}`);
    }
  }

  await retry(
    async () => {
      const walletClient = getWalletClient();
      const publicClient = createPublicClient({
        chain: getChain(),
        transport: http(config.rpcUrl),
      });

      const { request } = await publicClient.simulateContract({
        address: config.vammAddress as Hex,
        abi: VAMMABI,
        functionName: "initializeVAMM",
        args: [feedId, lastPrice.price],
        account: walletClient.account,
      });

      const txHash = await walletClient.writeContract(request);
      logger.info("P2PSettlement", `VAMM initialized for feed ${feedId} at $${Number(lastPrice.price) / 1e18}, tx: ${txHash}`);
    },
    3,
    2000,
    `initializeVAMM-${feedId}`
  );
}

async function deactivateVAMMForFeed(feedId: number): Promise<void> {
  if (!config.vammAddress) return;

  // Check if VAMM is already inactive — skip to avoid revert
  try {
    const publicClient = createPublicClient({
      chain: getChain(),
      transport: http(config.rpcUrl),
    });
    const vammState = await publicClient.readContract({
      address: config.vammAddress as Hex,
      abi: VAMMABI,
      functionName: "vamms",
      args: [feedId],
    }) as [bigint, bigint, bigint, bigint, boolean];
    if (!vammState[4]) {
      logger.info("P2PSettlement", `VAMM already inactive for feed ${feedId}, skipping deactivation`);
      return;
    }
  } catch {
    // Read failed — proceed with deactivation attempt
  }

  await retry(
    async () => {
      const walletClient = getWalletClient();
      const publicClient = createPublicClient({
        chain: getChain(),
        transport: http(config.rpcUrl),
      });

      const { request } = await publicClient.simulateContract({
        address: config.vammAddress as Hex,
        abi: VAMMABI,
        functionName: "deactivateVAMM",
        args: [feedId],
        account: walletClient.account,
      });

      const txHash = await walletClient.writeContract(request);
      logger.info("P2PSettlement", `VAMM deactivated for feed ${feedId}, tx: ${txHash}`);
    },
    3,
    2000,
    `deactivateVAMM-${feedId}`
  );
}

async function updateMarketStateOnChain(feedId: number): Promise<void> {
  if (!config.marketStateAddress) return;

  await retry(
    async () => {
      const walletClient = getWalletClient();
      const publicClient = createPublicClient({
        chain: getChain(),
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
    chain: getChain(),
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

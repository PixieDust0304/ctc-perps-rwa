import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { getChain } from "../config/chains.js";
import { TradingABI, CustodyABI } from "../abi/index.js";
import { getWalletClient } from "../utils/signing.js";
import { logger } from "../utils/logger.js";
import { getOpenPositions, enrichPosition } from "./positionTracker.js";
import { isSettlementInProgress } from "./keeperCoordinator.js";
import type { PriceTick } from "../types/index.js";
import type { CustodyState } from "../types/index.js";

const MAINTENANCE_MARGIN_BPS = 1000n; // 10% — matches on-chain maintenanceMarginBps
const BPS_DENOMINATOR = 10000n;
const PRECISION = 10n ** 18n;

// Cache custody state per feed (refreshed each tick)
const custodyStateCache = new Map<number, CustodyState>();

/**
 * Called after every price push — checks all tracked positions for liquidation
 */
export async function checkAndLiquidateAll(ticks: PriceTick[]): Promise<void> {
  if (!config.tradingAddress) return;

  // Build price map from current ticks
  const priceMap = new Map<number, bigint>();
  for (const tick of ticks) {
    priceMap.set(tick.feedId, tick.price);
  }

  // Refresh custody state for feeds with prices
  await refreshCustodyStates(Array.from(priceMap.keys()));

  const walletClient = getWalletClient();
  const publicClient = createPublicClient({
    chain: getChain(),
    transport: http(config.rpcUrl),
  });

  for (const [feedId, currentPrice] of priceMap) {
    // Don't run liquidations during settlement
    if (isSettlementInProgress(feedId)) continue;

    const positions = getOpenPositions(feedId);
    if (positions.length === 0) continue;

    const custodyState = custodyStateCache.get(feedId);
    if (!custodyState) continue;

    const liquidatable: Hex[] = [];
    let skippedEnrich = 0;

    for (const pos of positions) {
      // Enrich with on-chain fee snapshots if needed
      const enriched = await enrichPosition(pos.id);
      if (!enriched || enriched.openTimestamp === 0n) {
        skippedEnrich++;
        continue;
      }

      if (isLiquidatable(enriched, currentPrice, custodyState)) {
        logger.info("Liquidation", `Liquidatable: ${pos.id.slice(0, 10)}… ${enriched.isLong ? "LONG" : "SHORT"} collateral=${enriched.collateral} size=${enriched.sizeUsd} entry=${enriched.entryPrice} price=${currentPrice}`);
        liquidatable.push(pos.id);
      }
    }

    if (skippedEnrich > 0) {
      logger.warn("Liquidation", `Skipped ${skippedEnrich}/${positions.length} positions for feed ${feedId} (enrichment pending)`);
    }

    if (liquidatable.length === 0) continue;

    logger.info("Liquidation", `Found ${liquidatable.length} liquidatable positions for feed ${feedId}`);

    // Submit liquidation txs in parallel
    const results = await Promise.allSettled(
      liquidatable.map(async (positionId) => {
        try {
          const { request } = await publicClient.simulateContract({
            address: config.tradingAddress as Hex,
            abi: TradingABI,
            functionName: "liquidate",
            args: [positionId],
            account: walletClient.account,
          });
          const txHash = await walletClient.writeContract(request);
          logger.info("Liquidation", `Liquidated ${positionId}, tx: ${txHash}`);
        } catch (err) {
          // Simulation reverted — position not actually liquidatable (race, stale state, or pre-check mismatch)
          logger.warn("Liquidation", `Simulation reverted for ${positionId}: ${(err as Error).message.slice(0, 200)}`);
        }
      })
    );
  }
}

/**
 * Off-chain pre-check — mirrors Solidity liquidation math
 */
function isLiquidatable(
  pos: { isLong: boolean; collateral: bigint; sizeUsd: bigint; entryPrice: bigint; cumulativeBaseFeeSnapshot: bigint; cumulativeFundingSnapshot: bigint },
  currentPrice: bigint,
  custody: CustodyState
): boolean {
  // PnL
  const priceDelta = pos.isLong
    ? currentPrice - pos.entryPrice
    : pos.entryPrice - currentPrice;
  const isProfit = priceDelta > 0n;
  const absDelta = isProfit ? priceDelta : -priceDelta;
  const pnl = (pos.sizeUsd * absDelta) / pos.entryPrice;

  // Base fees
  const baseFeeAccum = pos.isLong
    ? custody.cumulativeLongBaseFeePerUnit
    : custody.cumulativeShortBaseFeePerUnit;
  const accumulatedFees = ((baseFeeAccum - pos.cumulativeBaseFeeSnapshot) * pos.sizeUsd) / PRECISION;

  // Funding (signed)
  const fundingDelta = custody.cumulativeFundingPerUnit - pos.cumulativeFundingSnapshot;
  const signedDelta = pos.isLong ? fundingDelta : -fundingDelta;
  const accumulatedFunding = (signedDelta * pos.sizeUsd) / PRECISION;

  // Effective collateral
  let effective = pos.collateral - accumulatedFees;
  // Subtract funding (can be negative = trader earns)
  if (accumulatedFunding > 0n) {
    effective -= accumulatedFunding;
  } else {
    effective += (-accumulatedFunding);
  }
  if (isProfit) {
    effective += pnl;
  } else {
    effective -= pnl;
  }

  // Liquidatable if below maintenance margin (10% of initial collateral)
  const maintenanceThreshold = (pos.collateral * MAINTENANCE_MARGIN_BPS) / BPS_DENOMINATOR;
  return effective < maintenanceThreshold;
}

async function refreshCustodyStates(feedIds: number[]): Promise<void> {
  const publicClient = createPublicClient({
    chain: getChain(),
    transport: http(config.rpcUrl),
  });

  await Promise.allSettled(
    feedIds.map(async (feedId) => {
      const addr = config.custodyAddresses[feedId];
      if (!addr) return;

      try {
        const [longBaseFee, shortBaseFee, funding] = await Promise.all([
          publicClient.readContract({
            address: addr as Hex,
            abi: CustodyABI,
            functionName: "cumulativeLongBaseFeePerUnit",
          }),
          publicClient.readContract({
            address: addr as Hex,
            abi: CustodyABI,
            functionName: "cumulativeShortBaseFeePerUnit",
          }),
          publicClient.readContract({
            address: addr as Hex,
            abi: CustodyABI,
            functionName: "cumulativeFundingPerUnit",
          }),
        ]);

        custodyStateCache.set(feedId, {
          cumulativeLongBaseFeePerUnit: longBaseFee as bigint,
          cumulativeShortBaseFeePerUnit: shortBaseFee as bigint,
          cumulativeFundingPerUnit: funding as bigint,
        });
      } catch (err) {
        logger.warn("Liquidation", `Failed to read custody state for feed ${feedId}: ${(err as Error).message.slice(0, 200)}`);
      }
    })
  );
}

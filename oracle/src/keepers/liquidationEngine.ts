import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { getChain } from "../config/chains.js";
import { TradingABI, CustodyABI } from "../abi/index.js";
import { getWalletClient } from "../utils/signing.js";
import { sendTx } from "../utils/txSender.js";
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

// Module-level singleton — avoids recreating on every tick
let _publicClient: ReturnType<typeof createPublicClient>;
function getPublicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: getChain(),
      transport: http(config.rpcUrl),
    });
  }
  return _publicClient;
}

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

  // Refresh custody state for feeds with prices (single multicall)
  await refreshCustodyStates(Array.from(priceMap.keys()));

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();

  for (const [feedId, currentPrice] of priceMap) {
    // Don't run liquidations during settlement
    if (isSettlementInProgress(feedId)) continue;

    const positions = getOpenPositions(feedId);
    if (positions.length === 0) continue;

    const custodyState = custodyStateCache.get(feedId);
    if (!custodyState) continue;

    // Batch-enrich all positions in parallel (single RPC round trip for cache misses)
    const enrichResults = await Promise.all(
      positions.map(pos => enrichPosition(pos.id))
    );

    const liquidatable: Hex[] = [];
    let skippedEnrich = 0;

    for (let i = 0; i < positions.length; i++) {
      const enriched = enrichResults[i];
      if (!enriched || enriched.openTimestamp === 0n) {
        skippedEnrich++;
        continue;
      }

      if (isLiquidatable(enriched, currentPrice, custodyState)) {
        logger.info("Liquidation", `Liquidatable: ${positions[i].id.slice(0, 10)}… ${enriched.isLong ? "LONG" : "SHORT"} collateral=${enriched.collateral} size=${enriched.sizeUsd} entry=${enriched.entryPrice} price=${currentPrice}`);
        liquidatable.push(positions[i].id);
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
          const txHash = await sendTx(request);
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

  // Effective collateral — mirrors PositionUtils.effectiveCollateral exactly
  let effective = pos.collateral - accumulatedFees;
  // Subtract funding (can be negative = trader earns)
  effective -= accumulatedFunding;
  // Match on-chain: if fees+funding consumed all collateral, position is dead (PnL can't save it)
  if (effective <= 0n) return true;
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
  const publicClient = getPublicClient();

  // Build multicall contracts array: 3 reads per feed
  const validFeeds: { feedId: number; addr: Hex }[] = [];
  const contracts: { address: Hex; abi: typeof CustodyABI; functionName: string }[] = [];

  for (const feedId of feedIds) {
    const addr = config.custodyAddresses[feedId];
    if (!addr) continue;
    validFeeds.push({ feedId, addr: addr as Hex });
    contracts.push(
      { address: addr as Hex, abi: CustodyABI, functionName: "cumulativeLongBaseFeePerUnit" },
      { address: addr as Hex, abi: CustodyABI, functionName: "cumulativeShortBaseFeePerUnit" },
      { address: addr as Hex, abi: CustodyABI, functionName: "cumulativeFundingPerUnit" },
    );
  }

  if (contracts.length === 0) return;

  try {
    const results = await publicClient.multicall({ contracts });

    // Parse results in groups of 3 (one group per feed)
    for (let i = 0; i < validFeeds.length; i++) {
      const base = i * 3;
      const longRes = results[base];
      const shortRes = results[base + 1];
      const fundingRes = results[base + 2];

      if (longRes.status === "success" && shortRes.status === "success" && fundingRes.status === "success") {
        custodyStateCache.set(validFeeds[i].feedId, {
          cumulativeLongBaseFeePerUnit: longRes.result as bigint,
          cumulativeShortBaseFeePerUnit: shortRes.result as bigint,
          cumulativeFundingPerUnit: fundingRes.result as bigint,
        });
      } else {
        logger.warn("Liquidation", `Multicall partial failure for feed ${validFeeds[i].feedId}`);
      }
    }
  } catch (err) {
    logger.warn("Liquidation", `Multicall custody read failed: ${(err as Error).message.slice(0, 200)}`);
  }
}

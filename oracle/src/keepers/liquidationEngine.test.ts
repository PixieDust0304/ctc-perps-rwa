import { describe, it, expect } from "vitest";

// Re-implement the off-chain pre-check math here for unit testing
// (mirrors the private isLiquidatable function in liquidationEngine.ts)

const MAINTENANCE_MARGIN_BPS = 3000n;
const BPS_DENOMINATOR = 10000n;
const PRECISION = 10n ** 18n;

interface TestPosition {
  isLong: boolean;
  collateral: bigint;
  sizeUsd: bigint;
  entryPrice: bigint;
  cumulativeBaseFeeSnapshot: bigint;
  cumulativeFundingSnapshot: bigint;
}

interface TestCustodyState {
  cumulativeLongBaseFeePerUnit: bigint;
  cumulativeShortBaseFeePerUnit: bigint;
  cumulativeFundingPerUnit: bigint;
}

function isLiquidatable(
  pos: TestPosition,
  currentPrice: bigint,
  custody: TestCustodyState
): boolean {
  const priceDelta = pos.isLong
    ? currentPrice - pos.entryPrice
    : pos.entryPrice - currentPrice;
  const isProfit = priceDelta > 0n;
  const absDelta = isProfit ? priceDelta : -priceDelta;
  const pnl = (pos.sizeUsd * absDelta) / pos.entryPrice;

  const baseFeeAccum = pos.isLong
    ? custody.cumulativeLongBaseFeePerUnit
    : custody.cumulativeShortBaseFeePerUnit;
  const accumulatedFees = ((baseFeeAccum - pos.cumulativeBaseFeeSnapshot) * pos.sizeUsd) / PRECISION;

  const fundingDelta = custody.cumulativeFundingPerUnit - pos.cumulativeFundingSnapshot;
  const signedDelta = pos.isLong ? fundingDelta : -fundingDelta;
  const accumulatedFunding = (signedDelta * pos.sizeUsd) / PRECISION;

  let effective = pos.collateral - accumulatedFees;
  if (accumulatedFunding > 0n) {
    effective -= accumulatedFunding;
  } else {
    effective += -accumulatedFunding;
  }
  if (isProfit) {
    effective += pnl;
  } else {
    effective -= pnl;
  }

  const maintenanceThreshold = (pos.collateral * MAINTENANCE_MARGIN_BPS) / BPS_DENOMINATOR;
  return effective < maintenanceThreshold;
}

describe("LiquidationEngine pre-check math", () => {
  const basePos: TestPosition = {
    isLong: true,
    collateral: 100n * PRECISION, // 100 USDC (18 decimals)
    sizeUsd: 1000n * PRECISION, // 10x leverage
    entryPrice: 2000n * PRECISION, // $2000 entry
    cumulativeBaseFeeSnapshot: 0n,
    cumulativeFundingSnapshot: 0n,
  };

  const zeroCustody: TestCustodyState = {
    cumulativeLongBaseFeePerUnit: 0n,
    cumulativeShortBaseFeePerUnit: 0n,
    cumulativeFundingPerUnit: 0n,
  };

  it("should not liquidate a healthy long position", () => {
    // Price went up 1% — PnL = +$10, well above 30% margin
    const currentPrice = 2020n * PRECISION;
    expect(isLiquidatable(basePos, currentPrice, zeroCustody)).toBe(false);
  });

  it("should liquidate a long position with large loss", () => {
    // Price dropped ~8% — PnL = -$80, effective = $20 < $30 threshold
    const currentPrice = 1840n * PRECISION;
    expect(isLiquidatable(basePos, currentPrice, zeroCustody)).toBe(true);
  });

  it("should not liquidate a short position in profit", () => {
    const shortPos = { ...basePos, isLong: false };
    // Price dropped — short profits
    const currentPrice = 1900n * PRECISION;
    expect(isLiquidatable(shortPos, currentPrice, zeroCustody)).toBe(false);
  });

  it("should liquidate a short position with large loss", () => {
    const shortPos = { ...basePos, isLong: false };
    // Price went up 8% — short loses ~$80
    const currentPrice = 2160n * PRECISION;
    expect(isLiquidatable(shortPos, currentPrice, zeroCustody)).toBe(true);
  });

  it("should account for accumulated base fees", () => {
    // Position barely profitable but fees eat into collateral
    const currentPrice = 2010n * PRECISION; // +$5 PnL
    const custody: TestCustodyState = {
      ...zeroCustody,
      // Fees accumulated: 75 USDC worth (snapshot delta * size / precision)
      cumulativeLongBaseFeePerUnit: (75n * PRECISION) / (1000n), // 0.075 per unit * 1000 sizeUsd
    };
    // Effective = 100 - 75 + 5 = $30, threshold is $30 — borderline
    // Let's push fees slightly higher to make it liquidatable
    const custodyHighFees: TestCustodyState = {
      ...zeroCustody,
      cumulativeLongBaseFeePerUnit: (76n * PRECISION) / 1000n,
    };
    expect(isLiquidatable(basePos, currentPrice, custodyHighFees)).toBe(true);
  });

  it("should account for funding payments (longs pay shorts)", () => {
    const currentPrice = 2000n * PRECISION; // no PnL
    // Funding: longs pay 75 USDC
    const custody: TestCustodyState = {
      ...zeroCustody,
      cumulativeFundingPerUnit: (75n * PRECISION) / 1000n,
    };
    // Effective = 100 - 0 (fees) - 75 (funding) = $25 < $30
    expect(isLiquidatable(basePos, currentPrice, custody)).toBe(true);
  });

  it("should account for funding received (shorts receive)", () => {
    const shortPos = { ...basePos, isLong: false };
    const currentPrice = 2000n * PRECISION;
    // Positive funding means shorts receive
    const custody: TestCustodyState = {
      ...zeroCustody,
      cumulativeFundingPerUnit: (50n * PRECISION) / 1000n,
    };
    // Short gets funding: signedDelta = -fundingDelta = negative, so accumulatedFunding < 0
    // effective = 100 - 0 + 50 = $150 > $30
    expect(isLiquidatable(shortPos, currentPrice, custody)).toBe(false);
  });

  it("should handle exact maintenance margin boundary", () => {
    // Effective collateral = exactly 30% threshold
    // PnL loss = $70 → effective = $30 = threshold → NOT liquidatable (need strictly less)
    const currentPrice = 1860n * PRECISION; // loss = (140/2000)*1000 = $70
    expect(isLiquidatable(basePos, currentPrice, zeroCustody)).toBe(false);
  });
});

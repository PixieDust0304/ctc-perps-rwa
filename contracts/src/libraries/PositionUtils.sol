// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FixedPointMath} from "./FixedPointMath.sol";

/// @title PositionUtils
/// @notice PnL, margin, and liquidation calculations
library PositionUtils {
    using FixedPointMath for uint256;

    uint256 internal constant PRECISION = 1e18;

    /// @notice Calculate unrealized PnL
    /// @return pnl The absolute PnL value
    /// @return isProfit True if the position is in profit
    function calculatePnL(
        uint256 collateral,
        uint256 leverage,
        uint256 entryPrice,
        uint256 currentPrice,
        bool isLong
    ) internal pure returns (uint256 pnl, bool isProfit) {
        // sizeUsd = collateral * leverage (already in 18 decimals)
        uint256 sizeUsd = collateral.mulFp(leverage);
        if (isLong) {
            if (currentPrice >= entryPrice) {
                isProfit = true;
                pnl = FixedPointMath.mulDiv(sizeUsd, currentPrice - entryPrice, entryPrice);
            } else {
                isProfit = false;
                pnl = FixedPointMath.mulDiv(sizeUsd, entryPrice - currentPrice, entryPrice);
            }
        } else {
            if (entryPrice >= currentPrice) {
                isProfit = true;
                pnl = FixedPointMath.mulDiv(sizeUsd, entryPrice - currentPrice, entryPrice);
            } else {
                isProfit = false;
                pnl = FixedPointMath.mulDiv(sizeUsd, currentPrice - entryPrice, entryPrice);
            }
        }
    }

    /// @notice Calculate effective collateral after fees and PnL
    function effectiveCollateral(
        uint256 initialCollateral,
        uint256 accumulatedFees,
        uint256 fundingOwed,
        uint256 pnl,
        bool isProfit
    ) internal pure returns (uint256) {
        uint256 effective = initialCollateral;
        // Subtract fees
        uint256 totalDeductions = accumulatedFees + fundingOwed;
        if (totalDeductions >= effective) return 0;
        effective -= totalDeductions;
        // Apply PnL
        if (isProfit) {
            effective += pnl;
        } else {
            if (pnl >= effective) return 0;
            effective -= pnl;
        }
        return effective;
    }

    /// @notice Check if a position should be liquidated
    /// @param initialCollateral Original collateral
    /// @param currentEffectiveCollateral Effective collateral after fees/pnl
    /// @param maintenanceMarginBps Maintenance margin in basis points (e.g., 3000 = 30%)
    function isLiquidatable(
        uint256 initialCollateral,
        uint256 currentEffectiveCollateral,
        uint256 maintenanceMarginBps
    ) internal pure returns (bool) {
        uint256 maintenanceMargin = (initialCollateral * maintenanceMarginBps) / FixedPointMath.BPS;
        return currentEffectiveCollateral < maintenanceMargin;
    }

    /// @notice Cap payout at the minimum of position max and custody available
    function capPayout(
        uint256 pnl,
        uint256 collateral,
        uint256 leverage,
        uint256 custodyAvailable
    ) internal pure returns (uint256) {
        uint256 maxPayout = collateral.mulFp(leverage);
        uint256 capped = FixedPointMath.min(pnl, maxPayout);
        return FixedPointMath.min(capped, custodyAvailable);
    }
}

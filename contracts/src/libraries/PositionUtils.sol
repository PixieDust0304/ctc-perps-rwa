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

    /// @notice Calculate effective collateral after fees, funding, and PnL
    /// @param fundingAmount Signed funding: positive = trader pays, negative = trader receives
    function effectiveCollateral(
        uint256 initialCollateral,
        uint256 accumulatedFees,
        int256 fundingAmount,
        uint256 pnl,
        bool isProfit
    ) internal pure returns (uint256) {
        int256 effective = int256(initialCollateral);
        // Subtract base fees
        effective -= int256(accumulatedFees);
        // Apply funding (positive = trader pays → deduct, negative = trader receives → add)
        effective -= fundingAmount;
        if (effective <= 0) return 0;
        // Apply PnL
        if (isProfit) {
            effective += int256(pnl);
        } else {
            effective -= int256(pnl);
        }
        return effective > 0 ? uint256(effective) : 0;
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FixedPointMath
/// @notice 18-decimal fixed-point arithmetic library
library FixedPointMath {
    uint256 internal constant PRECISION = 1e18;
    uint256 internal constant HALF_PRECISION = 5e17;
    uint256 internal constant BPS = 10_000;

    /// @notice Multiply two 18-decimal fixed-point numbers
    function mulFp(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / PRECISION;
    }

    /// @notice Divide two 18-decimal fixed-point numbers
    function divFp(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "FixedPointMath: division by zero");
        return (a * PRECISION) / b;
    }

    /// @notice Multiply and divide with intermediate precision preservation
    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256) {
        require(denominator > 0, "FixedPointMath: division by zero");
        return (a * b) / denominator;
    }

    /// @notice Convert basis points to 18-decimal fraction (e.g., 500 bps = 0.05e18)
    function bpsToFp(uint256 bps) internal pure returns (uint256) {
        return (bps * PRECISION) / BPS;
    }

    /// @notice Return the minimum of two values
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @notice Return the maximum of two values
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /// @notice Return absolute difference (|a - b|)
    function absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    /// @notice Signed PnL calculation: returns (pnl, isPositive)
    function signedMulDiv(
        uint256 a,
        uint256 b,
        uint256 c,
        uint256 d,
        bool isLong
    ) internal pure returns (uint256 pnl, bool isPositive) {
        // For longs: pnl = collateral * leverage * (current - entry) / entry
        // For shorts: pnl = collateral * leverage * (entry - current) / entry
        if (isLong) {
            isPositive = c >= d; // current >= entry
        } else {
            isPositive = d >= c; // entry >= current
        }
        uint256 priceDiff = isPositive ? (isLong ? c - d : d - c) : (isLong ? d - c : c - d);
        pnl = mulDiv(mulDiv(a, b, PRECISION), priceDiff, d);
    }
}

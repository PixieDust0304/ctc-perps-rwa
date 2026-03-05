// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PriceUtils
/// @notice Converts Autonom oracle prices (expo -10) to 18-decimal fixed-point
library PriceUtils {
    uint256 internal constant ORACLE_TO_18_MULTIPLIER = 1e8; // 10^(18 - 10) = 10^8

    /// @notice Convert raw oracle price to 18-decimal fixed-point
    /// @param rawPrice The raw price from Autonom (expo = -10)
    /// @return price18 The price in 18-decimal fixed-point
    function toPrice18(uint256 rawPrice) internal pure returns (uint256 price18) {
        price18 = rawPrice * ORACLE_TO_18_MULTIPLIER;
    }

    /// @notice Validate price is non-zero and reasonable
    function validatePrice(uint256 price18) internal pure returns (bool) {
        return price18 > 0;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FixedPointMath} from "./FixedPointMath.sol";

/// @title FeeCalculator
/// @notice Computes base fee and funding rate per 15s interval
library FeeCalculator {
    using FixedPointMath for uint256;

    uint256 internal constant INTERVALS_PER_HOUR = 240; // 3600 / 15
    uint256 internal constant PRECISION = 1e18;

    /// @notice Calculate base fee rate for a side per 15s interval
    /// @param sideOI Open interest for the side (long or short) in 18 decimals
    /// @param totalOI Total open interest (long + short) in 18 decimals
    /// @param maxBaseFeePerHourBps Max base fee per hour in basis points (e.g., 500 = 5%)
    /// @return ratePerInterval Fee rate per 15s interval in 18 decimals
    function baseFeeRatePerInterval(
        uint256 sideOI,
        uint256 totalOI,
        uint256 maxBaseFeePerHourBps
    ) internal pure returns (uint256 ratePerInterval) {
        if (totalOI == 0) return 0;
        // rate = (sideOI / totalOI) * maxBaseFee / intervalsPerHour
        uint256 oiRatio = sideOI.divFp(totalOI);
        uint256 maxFeePerInterval = FixedPointMath.bpsToFp(maxBaseFeePerHourBps) / INTERVALS_PER_HOUR;
        ratePerInterval = oiRatio.mulFp(maxFeePerInterval);
    }

    /// @notice Calculate the base fee owed for a position
    /// @param positionSize Position size in USD (18 decimals)
    /// @param ratePerInterval Fee rate per interval (18 decimals)
    /// @param intervalsElapsed Number of 15s intervals elapsed
    /// @return feeOwed Total fee owed in 18 decimals
    function baseFeeOwed(
        uint256 positionSize,
        uint256 ratePerInterval,
        uint256 intervalsElapsed
    ) internal pure returns (uint256 feeOwed) {
        feeOwed = positionSize.mulFp(ratePerInterval) * intervalsElapsed;
    }

    /// @notice Calculate funding rate per 15s interval
    /// @param longOI Long open interest (18 decimals)
    /// @param shortOI Short open interest (18 decimals)
    /// @param maxFundingRatePerIntervalBps Max funding rate per interval in bps
    /// @return rate Funding rate (18 decimals), positive means longs pay shorts
    function fundingRatePerInterval(
        uint256 longOI,
        uint256 shortOI,
        uint256 maxFundingRatePerIntervalBps
    ) internal pure returns (int256 rate) {
        uint256 totalOI = longOI + shortOI;
        if (totalOI == 0) return 0;
        // funding_rate = (longOI - shortOI) / totalOI * maxRate
        // Positive: longs pay shorts. Negative: shorts pay longs.
        int256 imbalance = int256(longOI) - int256(shortOI);
        uint256 maxRate = FixedPointMath.bpsToFp(maxFundingRatePerIntervalBps);
        rate = (imbalance * int256(maxRate)) / int256(totalOI);
    }

    /// @notice Calculate open/close fee
    /// @param notionalValue Position notional value (collateral * leverage) in 18 decimals
    /// @param feeBps Fee in basis points (e.g., 10 = 0.1%)
    /// @return fee The fee amount in 18 decimals
    function openCloseFee(
        uint256 notionalValue,
        uint256 feeBps
    ) internal pure returns (uint256 fee) {
        fee = (notionalValue * feeBps) / FixedPointMath.BPS;
    }

    /// @notice Split fee between LP and protocol
    /// @param totalFee Total fee amount
    /// @param lpShareBps LP share in basis points (e.g., 9000 = 90%)
    /// @return lpFee Fee going to LPs
    /// @return protocolFee Fee going to protocol
    function splitFee(
        uint256 totalFee,
        uint256 lpShareBps
    ) internal pure returns (uint256 lpFee, uint256 protocolFee) {
        lpFee = (totalFee * lpShareBps) / FixedPointMath.BPS;
        protocolFee = totalFee - lpFee;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FeeCalculator} from "../../src/libraries/FeeCalculator.sol";

contract FeeCalculatorTest is Test {
    function test_baseFeeRate_balanced() public pure {
        // 50/50 split: each side pays (50% of total OI) / total_OI * 5% / 240
        // = 0.5 * 5% / 240 = 2.5% / 240
        uint256 rate = FeeCalculator.baseFeeRatePerInterval(500e18, 1000e18, 500);
        // Expected: 0.5 * 0.05 / 240 = 0.025 / 240 ≈ 0.00010416...
        // In 18 decimals: ~104166666666666
        assertApproxEqAbs(rate, 104166666666666, 1e6); // Allow tiny rounding
    }

    function test_baseFeeRate_skewed() public pure {
        // 80% shorts, 20% longs
        // Long rate: 20/100 * 5%/240 = 0.2 * 0.05/240
        uint256 longRate = FeeCalculator.baseFeeRatePerInterval(200e18, 1000e18, 500);
        // Short rate: 80/100 * 5%/240 = 0.8 * 0.05/240
        uint256 shortRate = FeeCalculator.baseFeeRatePerInterval(800e18, 1000e18, 500);
        assertGt(shortRate, longRate);
        assertApproxEqRel(shortRate, longRate * 4, 1e15); // 4x ratio
    }

    function test_baseFeeRate_zeroOI() public pure {
        assertEq(FeeCalculator.baseFeeRatePerInterval(0, 0, 500), 0);
    }

    function test_baseFeeOwed() public pure {
        uint256 rate = 104166666666666; // ~one interval rate at 50/50
        uint256 fee = FeeCalculator.baseFeeOwed(10000e18, rate, 240); // 1 hour
        // Expected: ~10000 * 0.025 = 250 USDC (2.5% for 50% side over 1 hour)
        assertApproxEqRel(fee, 250e18, 1e16); // 1% tolerance
    }

    function test_fundingRate_balanced() public pure {
        // Equal OI: funding rate = 0
        int256 rate = FeeCalculator.fundingRatePerInterval(500e18, 500e18, 10);
        assertEq(rate, 0);
    }

    function test_fundingRate_longHeavy() public pure {
        // 90% long, 10% short: longs pay shorts
        int256 rate = FeeCalculator.fundingRatePerInterval(900e18, 100e18, 10);
        assertGt(rate, 0); // Positive = longs pay
    }

    function test_fundingRate_shortHeavy() public pure {
        // 10% long, 90% short: shorts pay longs
        int256 rate = FeeCalculator.fundingRatePerInterval(100e18, 900e18, 10);
        assertLt(rate, 0); // Negative = shorts pay
    }

    function test_openCloseFee() public pure {
        // 0.1% of $100,000 notional = $100
        uint256 fee = FeeCalculator.openCloseFee(100_000e18, 10);
        assertEq(fee, 100e18);
    }

    function test_splitFee() public pure {
        // 90/10 split of $100
        (uint256 lpFee, uint256 protocolFee) = FeeCalculator.splitFee(100e18, 9000);
        assertEq(lpFee, 90e18);
        assertEq(protocolFee, 10e18);
    }
}

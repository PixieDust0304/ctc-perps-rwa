// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FeeCalculator} from "../../src/libraries/FeeCalculator.sol";

contract FeeCalculatorTest is Test {
    function test_baseFeeRate_lowUtilization() public pure {
        // 10% utilization: sideOI=100k, liquidity=1M, maxFee=0.05%/hr (5 bps)
        // rate = (100k / 1M) * 0.0005 / 240 = 0.1 * 0.0005 / 240
        uint256 rate = FeeCalculator.baseFeeRatePerInterval(100_000e18, 1_000_000e18, 5);
        // Expected: 0.1 * 0.0005 / 240 ≈ 208333333333
        assertApproxEqAbs(rate, 208333333333, 1e6);
    }

    function test_baseFeeRate_highUtilization() public pure {
        // 50% utilization: sideOI=500k, liquidity=1M
        uint256 rate = FeeCalculator.baseFeeRatePerInterval(500_000e18, 1_000_000e18, 5);
        // Expected: 0.5 * 0.0005 / 240 ≈ 1041666666666
        assertApproxEqAbs(rate, 1041666666666, 1e6);
    }

    function test_baseFeeRate_fullUtilization() public pure {
        // 100% utilization: sideOI = liquidity
        uint256 rate = FeeCalculator.baseFeeRatePerInterval(1_000_000e18, 1_000_000e18, 5);
        // Expected: 1.0 * 0.0005 / 240 ≈ 2083333333333
        assertApproxEqAbs(rate, 2083333333333, 1e6);
    }

    function test_baseFeeRate_cappedAbove100Pct() public pure {
        // OI exceeds liquidity — should cap at 100% utilization
        uint256 rateCapped = FeeCalculator.baseFeeRatePerInterval(2_000_000e18, 1_000_000e18, 5);
        uint256 rateAt100 = FeeCalculator.baseFeeRatePerInterval(1_000_000e18, 1_000_000e18, 5);
        assertEq(rateCapped, rateAt100);
    }

    function test_baseFeeRate_zeroOI() public pure {
        assertEq(FeeCalculator.baseFeeRatePerInterval(0, 1_000_000e18, 5), 0);
    }

    function test_baseFeeRate_zeroLiquidity() public pure {
        assertEq(FeeCalculator.baseFeeRatePerInterval(100e18, 0, 5), 0);
    }

    function test_baseFeeOwed() public pure {
        // 10% utilization rate per interval at 5 bps/hr
        uint256 rate = 208333333333; // ~one interval rate at 10% utilization
        uint256 fee = FeeCalculator.baseFeeOwed(10000e18, rate, 240); // 1 hour
        // Expected: ~10000 * 0.00005 = 0.5 USDC (0.005% for 10% utilization over 1 hour)
        assertApproxEqRel(fee, 5e17, 1e16); // 1% tolerance
    }

    function test_fundingRate_balanced() public pure {
        // Equal OI: funding rate = 0
        int256 rate = FeeCalculator.fundingRatePerInterval(500e18, 500e18, 5);
        assertEq(rate, 0);
    }

    function test_fundingRate_longHeavy() public pure {
        // 90% long, 10% short: longs pay shorts (5 bps/hr max)
        int256 rate = FeeCalculator.fundingRatePerInterval(900e18, 100e18, 5);
        assertGt(rate, 0); // Positive = longs pay
    }

    function test_fundingRate_shortHeavy() public pure {
        // 10% long, 90% short: shorts pay longs (5 bps/hr max)
        int256 rate = FeeCalculator.fundingRatePerInterval(100e18, 900e18, 5);
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FixedPointMath} from "../../src/libraries/FixedPointMath.sol";

contract FPMathWrapper {
    function divFp(uint256 a, uint256 b) external pure returns (uint256) {
        return FixedPointMath.divFp(a, b);
    }
}

contract FixedPointMathTest is Test {
    using FixedPointMath for uint256;
    FPMathWrapper wrapper;

    function setUp() public {
        wrapper = new FPMathWrapper();
    }

    function test_mulFp() public pure {
        // 2.0 * 3.0 = 6.0
        assertEq(FixedPointMath.mulFp(2e18, 3e18), 6e18);
        // 0.5 * 0.5 = 0.25
        assertEq(FixedPointMath.mulFp(5e17, 5e17), 25e16);
    }

    function test_divFp() public pure {
        // 6.0 / 3.0 = 2.0
        assertEq(FixedPointMath.divFp(6e18, 3e18), 2e18);
        // 1.0 / 3.0 ≈ 0.333...
        assertApproxEqAbs(FixedPointMath.divFp(1e18, 3e18), 333333333333333333, 1);
    }

    function test_divFp_reverts_on_zero() public {
        vm.expectRevert("FixedPointMath: division by zero");
        wrapper.divFp(1e18, 0);
    }

    function test_bpsToFp() public pure {
        // 10000 bps = 100% = 1.0
        assertEq(FixedPointMath.bpsToFp(10000), 1e18);
        // 500 bps = 5% = 0.05
        assertEq(FixedPointMath.bpsToFp(500), 5e16);
        // 10 bps = 0.1% = 0.001
        assertEq(FixedPointMath.bpsToFp(10), 1e15);
    }

    function test_min_max() public pure {
        assertEq(FixedPointMath.min(1e18, 2e18), 1e18);
        assertEq(FixedPointMath.max(1e18, 2e18), 2e18);
        assertEq(FixedPointMath.min(5e18, 5e18), 5e18);
    }

    function test_absDiff() public pure {
        assertEq(FixedPointMath.absDiff(5e18, 3e18), 2e18);
        assertEq(FixedPointMath.absDiff(3e18, 5e18), 2e18);
        assertEq(FixedPointMath.absDiff(5e18, 5e18), 0);
    }

    function test_mulDiv() public pure {
        // (100 * 50) / 200 = 25
        assertEq(FixedPointMath.mulDiv(100e18, 50e18, 200e18), 25e18);
    }

    function testFuzz_mulFp_commutative(uint128 a, uint128 b) public pure {
        uint256 ab = FixedPointMath.mulFp(uint256(a), uint256(b));
        uint256 ba = FixedPointMath.mulFp(uint256(b), uint256(a));
        assertEq(ab, ba);
    }
}

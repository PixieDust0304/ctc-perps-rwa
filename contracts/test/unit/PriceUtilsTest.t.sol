// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PriceUtils} from "../../src/libraries/PriceUtils.sol";

contract PriceUtilsTest is Test {
    // Raw oracle values: actual_price = raw * 10^(-10)
    // To get 18 decimals: raw * 10^8

    function test_toPrice18_gold() public pure {
        // Gold ~$3037.70: raw = 30377000000000 (3.0377e13)
        // 30377000000000 * 1e8 = 3.0377e21 = 3037.7e18
        uint256 price18 = PriceUtils.toPrice18(30377000000000);
        assertEq(price18, 3037.7e18);
    }

    function test_toPrice18_silver() public pure {
        // Silver ~$83: raw = 830000000000
        // 830000000000 * 1e8 = 8.3e19 = 83e18
        uint256 price18 = PriceUtils.toPrice18(830000000000);
        assertEq(price18, 83e18);
    }

    function test_toPrice18_copper() public pure {
        // Copper ~$2.95: raw = 29500000000
        // 29500000000 * 1e8 = 2.95e18
        uint256 price18 = PriceUtils.toPrice18(29500000000);
        assertEq(price18, 2.95e18);
    }

    function test_toPrice18_platinum() public pure {
        // Platinum ~$2277: raw = 22770000000000
        // 22770000000000 * 1e8 = 2.277e21 = 2277e18
        uint256 price18 = PriceUtils.toPrice18(22770000000000);
        assertEq(price18, 2277e18);
    }

    function test_validatePrice() public pure {
        assertTrue(PriceUtils.validatePrice(1e18));
        assertFalse(PriceUtils.validatePrice(0));
    }
}

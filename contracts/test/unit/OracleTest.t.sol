// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {IOracle} from "../../src/interfaces/IOracle.sol";

contract OracleTest is TestSetup {
    function test_initialize() public view {
        assertEq(oracle.trustedSigner(), signer);
        assertEq(oracle.stalenessThreshold(), STALENESS_THRESHOLD);
        assertTrue(oracle.supportedFeeds(GOLD_FEED));
        assertTrue(oracle.supportedFeeds(SILVER_FEED));
        assertTrue(oracle.supportedFeeds(CRUDE_OIL_FEED));
        assertTrue(oracle.supportedFeeds(PLATINUM_FEED));
    }

    function test_updatePrices_single() public {
        uint256 ts = block.timestamp;
        // Gold ~$3037.70: raw = 30377000000000 (expo -10)
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts, true);

        IOracle.PriceData memory data = oracle.getPrice(GOLD_FEED);
        assertEq(data.price, 3037.7e18);
        assertEq(data.timestamp, ts);
        assertTrue(data.fresh);
    }

    function test_updatePrices_batch() public {
        uint256 ts = block.timestamp;
        _updateAllPrices(
            30377000000000,  // Gold ~$3037.70
            830000000000,    // Silver ~$83
            29500000000,     // CrudeOil ~$2.95 (test value)
            22770000000000,  // Platinum ~$2277
            ts,
            true
        );

        assertEq(oracle.getPrice(GOLD_FEED).price, 3037.7e18);
        assertEq(oracle.getPrice(SILVER_FEED).price, 83e18);
        assertEq(oracle.getPrice(CRUDE_OIL_FEED).price, 2.95e18);
        assertEq(oracle.getPrice(PLATINUM_FEED).price, 2277e18);
    }

    function test_updatePrices_rejectsInvalidSignature() public {
        uint16[] memory feedIds = new uint16[](1);
        uint256[] memory prices = new uint256[](1);
        uint256[] memory timestamps = new uint256[](1);
        bool[] memory freshFlags = new bool[](1);

        feedIds[0] = GOLD_FEED;
        prices[0] = 30377000000000;
        timestamps[0] = block.timestamp;
        freshFlags[0] = true;

        // Sign with wrong key
        uint256 wrongKey = 0xDEAD;
        bytes32 messageHash = keccak256(abi.encode(feedIds, prices, timestamps, freshFlags));
        bytes32 ethSignedHash = MessageHashUtils_toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Oracle: invalid signature");
        oracle.updatePrices(feedIds, prices, timestamps, freshFlags, signature);
    }

    function test_updatePrices_rejectsStaleUpdate() public {
        uint256 ts = block.timestamp;
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts, true);

        // Try to submit older timestamp
        vm.expectRevert("Oracle: stale update");
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts - 1, true);
    }

    function test_updatePrices_rejectsUnsupportedFeed() public {
        uint16[] memory feedIds = new uint16[](1);
        uint256[] memory prices = new uint256[](1);
        uint256[] memory timestamps = new uint256[](1);
        bool[] memory freshFlags = new bool[](1);

        feedIds[0] = 9999; // unsupported
        prices[0] = 1000;
        timestamps[0] = block.timestamp;
        freshFlags[0] = true;

        bytes32 messageHash = keccak256(abi.encode(feedIds, prices, timestamps, freshFlags));
        bytes32 ethSignedHash = MessageHashUtils_toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Oracle: unsupported feed");
        oracle.updatePrices(feedIds, prices, timestamps, freshFlags, signature);
    }

    function test_getPriceIfFresh_succeeds() public {
        uint256 ts = block.timestamp;
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts, true);

        IOracle.PriceData memory data = oracle.getPriceIfFresh(GOLD_FEED);
        assertEq(data.price, 3037.7e18);
    }

    function test_getPriceIfFresh_rejectsClosedMarket() public {
        uint256 ts = block.timestamp;
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts, false);

        vm.expectRevert("Oracle: market closed");
        oracle.getPriceIfFresh(GOLD_FEED);
    }

    function test_getPriceIfFresh_rejectsStalePrice() public {
        uint256 ts = block.timestamp;
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts, true);

        // Fast forward past staleness threshold
        vm.warp(ts + STALENESS_THRESHOLD + 1);

        vm.expectRevert("Oracle: stale price");
        oracle.getPriceIfFresh(GOLD_FEED);
    }

    function test_setTrustedSigner() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(admin);
        oracle.setTrustedSigner(newSigner);
        assertEq(oracle.trustedSigner(), newSigner);
    }

    function test_setTrustedSigner_rejectsZero() public {
        vm.prank(admin);
        vm.expectRevert("Oracle: zero signer");
        oracle.setTrustedSigner(address(0));
    }

    function test_setTrustedSigner_onlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        oracle.setTrustedSigner(user1);
    }

    function test_pause_unpause() public {
        vm.prank(admin);
        oracle.pause();

        // Updating prices should fail when paused
        vm.expectRevert();
        _updateOraclePrice(GOLD_FEED, 30377000000000, block.timestamp, true);

        vm.prank(admin);
        oracle.unpause();

        // Should work again
        _updateOraclePrice(GOLD_FEED, 30377000000000, block.timestamp, true);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pool} from "../../src/core/Pool.sol";
import {Custody} from "../../src/core/Custody.sol";
import {VAMM} from "../../src/core/VAMM.sol";
import {P2PTrading} from "../../src/core/P2PTrading.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";
import {MarketState} from "../../src/core/MarketState.sol";

contract P2PTradingTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    VAMM public vamm;
    P2PTrading public p2pTrading;
    FeeManager public feeManager;
    MarketState public marketState;

    uint256 constant GOLD_RAW = 30377000000000;
    uint256 constant GOLD_PRICE = 3037.7e18;
    uint256 constant VAMM_DEPTH = 13_000_000e18; // $13M virtual depth for gold

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);

        // Deploy Pool
        Pool poolImpl = new Pool();
        pool = Pool(address(new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(Pool.initialize, (admin, address(usdc), address(clp), admin, 9000))
        )));
        clp.transferOwnership(address(pool));

        // Deploy Gold Custody
        Custody custImpl = new Custody();
        goldCustody = Custody(address(new ERC1967Proxy(
            address(custImpl),
            abi.encodeCall(Custody.initialize, (admin, GOLD_FEED, address(usdc), address(pool), 500, 1))
        )));
        pool.addCustody(address(goldCustody), 10000);

        // Deploy FeeManager
        FeeManager fmImpl = new FeeManager();
        feeManager = FeeManager(address(new ERC1967Proxy(
            address(fmImpl),
            abi.encodeCall(FeeManager.initialize, (admin, 10, 500, 1, 9000))
        )));

        // Deploy MarketState
        MarketState msImpl = new MarketState();
        marketState = MarketState(address(new ERC1967Proxy(
            address(msImpl),
            abi.encodeCall(MarketState.initialize, (admin, address(oracle)))
        )));
        marketState.registerFeed(GOLD_FEED);

        // Deploy VAMM
        VAMM vammImpl = new VAMM();
        vamm = VAMM(address(new ERC1967Proxy(
            address(vammImpl),
            abi.encodeCall(VAMM.initialize, (admin))
        )));
        vamm.setDepthMultiplier(GOLD_FEED, VAMM_DEPTH);

        // Deploy P2PTrading
        P2PTrading p2pImpl = new P2PTrading();
        p2pTrading = P2PTrading(address(new ERC1967Proxy(
            address(p2pImpl),
            abi.encodeCall(P2PTrading.initialize, (
                admin,
                address(usdc),
                address(vamm),
                address(pool),
                address(marketState),
                address(feeManager),
                100e18,  // maxLeverage
                10e18,   // minPositionUsd
                120      // minPositionOpenTime
            ))
        )));

        // Wire
        vamm.setP2PTrading(address(p2pTrading));
        vamm.setMarketState(address(marketState));
        p2pTrading.setSettlementKeeper(admin);
        pool.setP2PTrading(address(p2pTrading));

        vm.stopPrank();

        // Seed pool
        vm.startPrank(user1);
        usdc.approve(address(pool), 100_000e18);
        pool.deposit(100_000e18);
        vm.stopPrank();

        // Set initial price, then close market
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        // Close market and init VAMM
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp + 1, false);
        marketState.updateState(GOLD_FEED);

        vm.prank(admin);
        vamm.initializeVAMM(GOLD_FEED, GOLD_PRICE);
    }

    function test_vamm_initialized() public view {
        uint256 vammPrice = vamm.getVAMMPrice(GOLD_FEED);
        assertApproxEqRel(vammPrice, GOLD_PRICE, 1e15); // 0.1% tolerance
    }

    function test_openP2PPosition_long() public {
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 1000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        assertEq(p2pTrading.p2pLongOI(GOLD_FEED), 10_000e18);
    }

    function test_openP2PPosition_rejectsOpenMarket() public {
        // Reopen market
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp + 2, true);
        marketState.updateState(GOLD_FEED);

        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 1000e18);
        vm.expectRevert("P2P: market is open");
        p2pTrading.openP2PPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();
    }

    function test_vamm_priceImpact() public {
        uint256 priceBefore = vamm.getVAMMPrice(GOLD_FEED);

        // Open large long — should push price up
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 100_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 100_000e18, 10e18);
        vm.stopPrank();

        uint256 priceAfter = vamm.getVAMMPrice(GOLD_FEED);
        assertGt(priceAfter, priceBefore, "Long should push VAMM price up");
    }

    function test_closeP2PPosition() public {
        // Open long
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 1000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1), "p2p"));

        // Warp past min open time
        vm.warp(block.timestamp + 121);

        uint256 balBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        p2pTrading.closeP2PPosition(posId);
        uint256 balAfter = usdc.balanceOf(user2);

        // Should get back roughly collateral minus fees (no opposing side to profit from)
        assertGt(balAfter, balBefore);
    }

    function test_closeP2PPosition_rejectsMinTime() public {
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 1000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 1000e18, 10e18);

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1), "p2p"));

        vm.expectRevert("P2P: min open time");
        p2pTrading.closeP2PPosition(posId);
        vm.stopPrank();
    }

    function test_settleBatch_atMarketOpen() public {
        // Open long (user2) and short (user3) positions
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 1000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        vm.startPrank(user3);
        usdc.approve(address(p2pTrading), 1000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, false, 1000e18, 10e18);
        vm.stopPrank();

        bytes32 posId1 = keccak256(abi.encodePacked(user2, uint256(1), "p2p"));
        bytes32 posId2 = keccak256(abi.encodePacked(user3, uint256(2), "p2p"));

        // Market reopens — settle at spot price (5% above entry for gold)
        uint256 settlementPrice = GOLD_PRICE * 105 / 100;

        bytes32[] memory posIds = new bytes32[](2);
        posIds[0] = posId1;
        posIds[1] = posId2;

        vm.prank(admin);
        p2pTrading.settleP2PBatch(posIds, settlementPrice);

        // Long should profit, short should lose
        // Both positions should be settled
        assertEq(p2pTrading.p2pLongOI(GOLD_FEED), 0);
        assertEq(p2pTrading.p2pShortOI(GOLD_FEED), 0);
    }
}

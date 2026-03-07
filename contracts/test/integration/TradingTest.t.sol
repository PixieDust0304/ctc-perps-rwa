// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pool} from "../../src/core/Pool.sol";
import {Custody} from "../../src/core/Custody.sol";
import {Trading} from "../../src/core/Trading.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";
import {MarketState} from "../../src/core/MarketState.sol";

contract TradingTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    Trading public trading;
    FeeManager public feeManager;
    MarketState public marketState;

    uint256 constant GOLD_RAW = 30377000000000; // ~$3037.70
    uint256 constant GOLD_PRICE = 3037.7e18;

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);

        // Deploy Pool
        Pool poolImpl = new Pool();
        pool = Pool(address(new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(Pool.initialize, (admin, address(usdc), address(pmlp), admin, 9000))
        )));
        pmlp.transferOwnership(address(pool));

        // Deploy Gold Custody
        Custody custImpl = new Custody();
        goldCustody = Custody(address(new ERC1967Proxy(
            address(custImpl),
            abi.encodeCall(Custody.initialize, (admin, GOLD_FEED, address(usdc), address(pool), 5, 5))
        )));
        pool.addCustody(address(goldCustody), 10000); // 100% to gold for simplicity

        // Deploy FeeManager
        FeeManager fmImpl = new FeeManager();
        feeManager = FeeManager(address(new ERC1967Proxy(
            address(fmImpl),
            abi.encodeCall(FeeManager.initialize, (admin, 10, 5, 5, 9000, 10))
        )));

        // Deploy MarketState
        MarketState msImpl = new MarketState();
        marketState = MarketState(address(new ERC1967Proxy(
            address(msImpl),
            abi.encodeCall(MarketState.initialize, (admin, address(oracle)))
        )));
        marketState.registerFeed(GOLD_FEED);

        // Deploy Trading
        Trading tradingImpl = new Trading();
        trading = Trading(address(new ERC1967Proxy(
            address(tradingImpl),
            abi.encodeCall(Trading.initialize, (
                admin,
                address(usdc),
                address(oracle),
                address(pool),
                address(feeManager),
                address(marketState),
                100e18,   // maxLeverage
                1000,     // maintenanceMarginBps (10%)
                10e18,    // minPositionUsd ($10)
                120       // minPositionOpenTime (120s)
            ))
        )));

        // Wire up permissions
        trading.setFeedCustody(GOLD_FEED, address(goldCustody));
        goldCustody.setTrading(address(trading));
        pool.setTrading(address(trading));

        vm.stopPrank();

        // Seed pool with LP liquidity
        vm.startPrank(user1);
        usdc.approve(address(pool), 100_000e18);
        pool.deposit(100_000e18);
        vm.stopPrank();

        // Set oracle price and open market
        _setGoldPriceAndOpenMarket(GOLD_RAW, block.timestamp);
    }

    function _setGoldPriceAndOpenMarket(uint256 rawPrice, uint256 ts) internal {
        _updateOraclePrice(GOLD_FEED, rawPrice, ts, true);
        marketState.updateState(GOLD_FEED);
    }

    // === Open Position Tests ===

    function test_openPosition_basic() public {
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18); // 10x long
        vm.stopPrank();

        // Check position exists
        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));
        Trading.Position memory pos = trading.getPosition(posId);
        assertEq(pos.owner, user2);
        assertTrue(pos.isLong);
        assertEq(pos.entryPrice, GOLD_PRICE);
        // Open fee: 0.1% of prelimSize(10000) = 10 USDC, collateralAfterFee = 990
        // sizeUsd = collateralAfterFee * leverage = 990 * 10 = 9900
        assertEq(pos.collateral, 990e18);
        assertEq(pos.sizeUsd, 9_900e18);
    }

    function test_openPosition_rejectsClosedMarket() public {
        // Close market
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp + 1, false);
        marketState.updateState(GOLD_FEED);

        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        vm.expectRevert("Trading: market closed");
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();
    }

    function test_openPosition_rejectsExcessiveLeverage() public {
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        vm.expectRevert("Trading: invalid leverage");
        trading.openPosition(GOLD_FEED, true, 1000e18, 101e18); // 101x
        vm.stopPrank();
    }

    // === Close Position Tests ===

    function test_closePosition_profitable_long() public {
        // Open 10x long at $3037.70
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Price goes up 5%: $3037.70 -> $3189.585
        uint256 newRaw = 31895850000000; // $3189.585
        vm.warp(block.timestamp + 121); // past min open time
        _setGoldPriceAndOpenMarket(newRaw, block.timestamp);

        uint256 balBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId);
        uint256 balAfter = usdc.balanceOf(user2);

        // Profit: 990 * 10 * 5% = ~495 USDC (approx, minus close fee)
        assertGt(balAfter - balBefore, 1400e18); // Collateral + profit
    }

    function test_closePosition_losing_long() public {
        // Open 10x long
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Price goes down 3%: $3037.70 -> $2946.569
        uint256 newRaw = 29465690000000;
        vm.warp(block.timestamp + 121);
        _setGoldPriceAndOpenMarket(newRaw, block.timestamp);

        uint256 balBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId);
        uint256 balAfter = usdc.balanceOf(user2);

        // Loss: 990 * 10 * 3% = ~297. Payout = 990 - 297 - closeFee = ~683
        assertGt(balAfter - balBefore, 600e18);
        assertLt(balAfter - balBefore, 800e18);
    }

    function test_closePosition_rejectsMinOpenTime() public {
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Try to close immediately
        vm.expectRevert("Trading: min open time");
        trading.closePosition(posId);
        vm.stopPrank();
    }

    // === Liquidation Tests ===

    function test_liquidate_undercollateralized() public {
        // Open 50x long at $3037.70
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 50e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Price drops enough to trigger liquidation at 10% maintenance margin
        // At 50x, buffer = 90% of collateral. 90% / 50x = 1.8% price move.
        // A 1.9% drop should trigger liquidation.
        uint256 newRaw = 29800000000000; // ~$2980.00 (~1.9% drop)
        vm.warp(block.timestamp + 121);
        _setGoldPriceAndOpenMarket(newRaw, block.timestamp);

        // Anyone can liquidate
        vm.prank(liquidator);
        trading.liquidate(posId);

        // Position should be closed
        Trading.Position memory pos = trading.getPosition(posId);
        assertEq(pos.collateral, 0);
    }

    function test_liquidate_rejectsHealthyPosition() public {
        // Open 2x long
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 2e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Small price drop — position still healthy at 2x
        uint256 newRaw = 30073230000000; // ~$3007.32 (~1% drop)
        vm.warp(block.timestamp + 121);
        _setGoldPriceAndOpenMarket(newRaw, block.timestamp);

        vm.prank(liquidator);
        vm.expectRevert("Trading: not liquidatable");
        trading.liquidate(posId);
    }

    // === Add Collateral Tests ===

    function test_addCollateral_basic() public {
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));
        Trading.Position memory posBefore = trading.getPosition(posId);
        uint256 custodyAvailBefore = goldCustody.availableBalance();
        uint256 custodyCollBefore = goldCustody.totalTraderCollateral();
        uint256 userBalBefore = usdc.balanceOf(user2);

        vm.startPrank(user2);
        usdc.approve(address(trading), 500e18);
        trading.addCollateral(posId, 500e18);
        vm.stopPrank();

        Trading.Position memory posAfter = trading.getPosition(posId);
        assertEq(posAfter.collateral, posBefore.collateral + 500e18);
        assertEq(goldCustody.availableBalance(), custodyAvailBefore + 500e18);
        assertEq(goldCustody.totalTraderCollateral(), custodyCollBefore + 500e18);
        assertEq(usdc.balanceOf(user2), userBalBefore - 500e18);
        // sizeUsd unchanged
        assertEq(posAfter.sizeUsd, posBefore.sizeUsd);
    }

    function test_addCollateral_notOwner_reverts() public {
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        vm.startPrank(user3);
        usdc.approve(address(trading), 500e18);
        vm.expectRevert("Trading: not owner");
        trading.addCollateral(posId, 500e18);
        vm.stopPrank();
    }

    function test_addCollateral_closedPosition_reverts() public {
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Close the position
        vm.warp(block.timestamp + 121);
        _setGoldPriceAndOpenMarket(GOLD_RAW, block.timestamp);
        vm.prank(user2);
        trading.closePosition(posId);

        // Try to add collateral to closed position
        vm.startPrank(user2);
        usdc.approve(address(trading), 500e18);
        vm.expectRevert("Trading: already closed");
        trading.addCollateral(posId, 500e18);
        vm.stopPrank();
    }

    function test_addCollateral_preventsLiquidation() public {
        // Open 50x long at $3037.70
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 50e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Price drops ~1.9% — would normally trigger liquidation at 50x
        uint256 newRaw = 29800000000000; // ~$2980.00
        vm.warp(block.timestamp + 121);
        _setGoldPriceAndOpenMarket(newRaw, block.timestamp);

        // Add significant collateral to save the position
        vm.startPrank(user2);
        usdc.approve(address(trading), 5000e18);
        trading.addCollateral(posId, 5000e18);
        vm.stopPrank();

        // Should no longer be liquidatable
        vm.prank(liquidator);
        vm.expectRevert("Trading: not liquidatable");
        trading.liquidate(posId);
    }

    function test_addCollateral_closePayout() public {
        // Open 10x long at $3037.70
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Add 500 USDC collateral
        vm.startPrank(user2);
        usdc.approve(address(trading), 500e18);
        trading.addCollateral(posId, 500e18);
        vm.stopPrank();

        // Price stays same, close position — payout should reflect updated collateral
        vm.warp(block.timestamp + 121);
        _setGoldPriceAndOpenMarket(GOLD_RAW, block.timestamp);

        uint256 balBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId);
        uint256 balAfter = usdc.balanceOf(user2);

        // Payout should be close to collateralAfterFee(990) + addedCollateral(500) - closeFee
        // At same price, PnL = 0, so payout ~= total collateral - close fee
        uint256 payout = balAfter - balBefore;
        assertGt(payout, 1400e18); // 990 + 500 - fees > 1400
        assertLt(payout, 1500e18); // but less than full 1490 due to close fee
    }

    // === Short Position Tests ===

    function test_openClose_short_profitable() public {
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, false, 1000e18, 10e18); // 10x short
        vm.stopPrank();

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));

        // Price drops 5%: profitable for shorts
        uint256 newRaw = 28858150000000; // ~$2885.815 (5% drop)
        vm.warp(block.timestamp + 121);
        _setGoldPriceAndOpenMarket(newRaw, block.timestamp);

        uint256 balBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId);
        uint256 balAfter = usdc.balanceOf(user2);

        assertGt(balAfter - balBefore, 1400e18);
    }

    // === Multiple Traders ===

    function test_multipleTraders_oi_tracking() public {
        // User2: 10x long
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        // User3: 5x short
        vm.startPrank(user3);
        usdc.approve(address(trading), 2000e18);
        trading.openPosition(GOLD_FEED, false, 2000e18, 5e18);
        vm.stopPrank();

        // Check OI: sizeUsd = collateralAfterFee * leverage
        // User2: fee=10, collAfterFee=990, size=990*10=9900
        // User3: fee=10, collAfterFee=1990, size=1990*5=9950
        assertEq(goldCustody.longOpenInterest(), 9_900e18);
        assertEq(goldCustody.shortOpenInterest(), 9_950e18);
    }
}

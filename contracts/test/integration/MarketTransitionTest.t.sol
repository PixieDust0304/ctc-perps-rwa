// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pool} from "../../src/core/Pool.sol";
import {Custody} from "../../src/core/Custody.sol";
import {Trading} from "../../src/core/Trading.sol";
import {P2PTrading} from "../../src/core/P2PTrading.sol";
import {VAMM} from "../../src/core/VAMM.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";
import {MarketState} from "../../src/core/MarketState.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MarketTransitionTest
/// @notice Tests: market open -> trade -> close market -> P2P trade -> settle at market open
/// Validates accounting across market state transitions
contract MarketTransitionTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    Trading public trading;
    P2PTrading public p2pTrading;
    VAMM public vamm;
    FeeManager public feeManager;
    MarketState public marketState;

    uint256 constant GOLD_RAW = 30377000000000;
    uint256 constant GOLD_PRICE = 3037.7e18;
    uint256 constant LP_DEPOSIT = 100_000e18;

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);

        Pool poolImpl = new Pool();
        pool = Pool(address(new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(Pool.initialize, (admin, address(usdc), address(pmlp), admin, 9000))
        )));
        pmlp.transferOwnership(address(pool));

        Custody custImpl = new Custody();
        goldCustody = Custody(address(new ERC1967Proxy(
            address(custImpl),
            abi.encodeCall(Custody.initialize, (admin, GOLD_FEED, address(usdc), address(pool), 5, 5))
        )));
        pool.addCustody(address(goldCustody), 10000);

        FeeManager fmImpl = new FeeManager();
        feeManager = FeeManager(address(new ERC1967Proxy(
            address(fmImpl),
            abi.encodeCall(FeeManager.initialize, (admin, 10, 5, 5, 9000, 10))
        )));

        MarketState msImpl = new MarketState();
        marketState = MarketState(address(new ERC1967Proxy(
            address(msImpl),
            abi.encodeCall(MarketState.initialize, (admin, address(oracle)))
        )));
        marketState.registerFeed(GOLD_FEED);

        Trading tradingImpl = new Trading();
        trading = Trading(address(new ERC1967Proxy(
            address(tradingImpl),
            abi.encodeCall(Trading.initialize, (
                admin, address(usdc), address(oracle), address(pool),
                address(feeManager), address(marketState),
                100e18, 1000, 10e18, 120
            ))
        )));

        VAMM vammImpl = new VAMM();
        vamm = VAMM(address(new ERC1967Proxy(
            address(vammImpl),
            abi.encodeCall(VAMM.initialize, (admin))
        )));

        P2PTrading p2pImpl = new P2PTrading();
        p2pTrading = P2PTrading(address(new ERC1967Proxy(
            address(p2pImpl),
            abi.encodeCall(P2PTrading.initialize, (
                admin, address(usdc), address(vamm), address(pool),
                address(marketState), address(feeManager),
                10e18, 120
            ))
        )));

        trading.setFeedCustody(GOLD_FEED, address(goldCustody));
        goldCustody.setTrading(address(trading));
        pool.setTrading(address(trading));
        pool.setP2PTrading(address(p2pTrading));
        p2pTrading.setSettlementKeeper(admin);

        // Configure VAMM for gold
        vamm.setDepthMultiplier(GOLD_FEED, 1e24);
        vamm.setP2PTrading(address(p2pTrading));
        vamm.setMarketState(address(marketState));

        vm.stopPrank();

        // Open market
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);
    }

    function _totalSystemUSDC() internal view returns (uint256) {
        return usdc.balanceOf(user1) + usdc.balanceOf(user2) + usdc.balanceOf(user3)
            + usdc.balanceOf(address(pool)) + usdc.balanceOf(address(goldCustody))
            + usdc.balanceOf(address(trading)) + usdc.balanceOf(address(p2pTrading))
            + usdc.balanceOf(admin);
    }

    /// @notice Full transition: market open trade -> close market -> P2P -> settle
    function test_marketTransition_fullCycle() public {
        uint256 systemBefore = _totalSystemUSDC();

        // LP deposits during market hours
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        assertEq(_totalSystemUSDC(), systemBefore, "USDC after LP deposit");

        // User2 opens market-hours position
        vm.startPrank(user2);
        usdc.approve(address(trading), 5000e18);
        trading.openPosition(GOLD_FEED, true, 5000e18, 10e18);
        vm.stopPrank();

        assertEq(_totalSystemUSDC(), systemBefore, "USDC after market open");

        // Close market-hours position before market closes
        vm.warp(block.timestamp + 121);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));
        vm.prank(user2);
        trading.closePosition(posId);

        assertEq(_totalSystemUSDC(), systemBefore, "USDC after market close position");

        // Close market (stale price = not fresh)
        vm.warp(block.timestamp + 121);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, false);
        marketState.updateState(GOLD_FEED);
        assertFalse(marketState.isMarketOpen(GOLD_FEED), "Market should be closed");

        // Initialize VAMM for off-hours trading
        vm.prank(admin);
        vamm.initializeVAMM(GOLD_FEED, GOLD_PRICE);

        // User3 opens P2P position during off-hours
        vm.startPrank(user3);
        usdc.approve(address(p2pTrading), 2000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 2000e18);
        vm.stopPrank();

        assertEq(_totalSystemUSDC(), systemBefore, "USDC after P2P open");

        // User3 closes P2P position
        vm.warp(block.timestamp + 121);
        bytes32 p2pPosId = keccak256(abi.encodePacked(user3, uint256(1), "p2p"));
        vm.prank(user3);
        p2pTrading.closeP2PPosition(p2pPosId);

        assertEq(_totalSystemUSDC(), systemBefore, "USDC after P2P close");

        // LP withdraws
        vm.startPrank(user1);
        pool.withdraw(pmlp.balanceOf(user1));
        vm.stopPrank();

        assertEq(_totalSystemUSDC(), systemBefore, "USDC after LP withdraw");
    }

    /// @notice P2P escrow should never go negative
    function test_p2pEscrow_cannotOverWithdraw() public {
        // Close market
        vm.warp(block.timestamp + 1);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, false);
        marketState.updateState(GOLD_FEED);

        // Initialize VAMM
        vm.prank(admin);
        vamm.initializeVAMM(GOLD_FEED, GOLD_PRICE);

        // Two traders open P2P positions
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 1000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 1000e18);
        vm.stopPrank();

        vm.startPrank(user3);
        usdc.approve(address(p2pTrading), 1000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, false, 1000e18);
        vm.stopPrank();

        uint256 escrowAfterOpen = p2pTrading.p2pEscrowBalance(GOLD_FEED);
        // Each gets collateralAfterFee = 1000 - 1 = 999 (0.1% of 1000 spot = 1)
        // So escrow = 999 + 999 = 1998

        // User2 closes — even if profitable, payout capped at other's escrow
        vm.warp(block.timestamp + 121);
        bytes32 pos2 = keccak256(abi.encodePacked(user2, uint256(1), "p2p"));
        vm.prank(user2);
        p2pTrading.closeP2PPosition(pos2);

        uint256 escrowAfterFirst = p2pTrading.p2pEscrowBalance(GOLD_FEED);
        // Escrow should never be negative (underflow would revert)
        assertGe(escrowAfterFirst, 0, "Escrow non-negative after first close");

        // User3 closes
        bytes32 pos3 = keccak256(abi.encodePacked(user3, uint256(2), "p2p"));
        vm.prank(user3);
        p2pTrading.closeP2PPosition(pos3);

        assertEq(p2pTrading.p2pEscrowBalance(GOLD_FEED), 0, "Escrow should be zero after all close");
    }

    /// @notice Batch settlement at market open preserves USDC
    function test_batchSettlement_conservesUSDC() public {
        uint256 systemBefore = _totalSystemUSDC();

        // Close market
        vm.warp(block.timestamp + 1);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, false);
        marketState.updateState(GOLD_FEED);

        // Initialize VAMM
        vm.prank(admin);
        vamm.initializeVAMM(GOLD_FEED, GOLD_PRICE);

        // Multiple P2P positions
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 3000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 1000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 2000e18);
        vm.stopPrank();

        vm.startPrank(user3);
        usdc.approve(address(p2pTrading), 3000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, false, 3000e18);
        vm.stopPrank();

        assertEq(_totalSystemUSDC(), systemBefore, "USDC after P2P opens");

        // Market opens — keeper batch settles
        vm.warp(block.timestamp + 200);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        // Build position IDs for settlement
        bytes32[] memory posIds = new bytes32[](3);
        posIds[0] = keccak256(abi.encodePacked(user2, uint256(1), "p2p"));
        posIds[1] = keccak256(abi.encodePacked(user2, uint256(2), "p2p"));
        posIds[2] = keccak256(abi.encodePacked(user3, uint256(3), "p2p"));

        // Settle at the oracle price
        vm.prank(admin);
        p2pTrading.settleP2PBatch(posIds, GOLD_PRICE);

        assertEq(_totalSystemUSDC(), systemBefore, "USDC after batch settlement");
    }
}

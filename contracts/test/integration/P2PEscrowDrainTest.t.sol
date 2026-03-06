// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pool} from "../../src/core/Pool.sol";
import {Custody} from "../../src/core/Custody.sol";
import {P2PTrading} from "../../src/core/P2PTrading.sol";
import {VAMM} from "../../src/core/VAMM.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";
import {MarketState} from "../../src/core/MarketState.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title P2PEscrowDrainTest
/// @notice Tests that the P2P escrow tracker stays in sync with actual USDC.
/// Previously, profitable closes only reduced escrow by collateral (not collateral + profit),
/// causing escrow tracker > actual USDC => subsequent traders can't close.
contract P2PEscrowDrainTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    P2PTrading public p2pTrading;
    VAMM public vamm;
    FeeManager public feeManager;
    MarketState public marketState;

    uint256 constant GOLD_RAW = 30377000000000;
    uint256 constant GOLD_PRICE = 3037.7e18;

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);

        Pool poolImpl = new Pool();
        pool = Pool(address(new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(Pool.initialize, (admin, address(usdc), address(clp), admin, 9000))
        )));
        clp.transferOwnership(address(pool));

        Custody custImpl = new Custody();
        goldCustody = Custody(address(new ERC1967Proxy(
            address(custImpl),
            abi.encodeCall(Custody.initialize, (admin, GOLD_FEED, address(usdc), address(pool), 5, 5))
        )));
        pool.addCustody(address(goldCustody), 10000);

        FeeManager fmImpl = new FeeManager();
        feeManager = FeeManager(address(new ERC1967Proxy(
            address(fmImpl),
            abi.encodeCall(FeeManager.initialize, (admin, 10, 5, 5, 9000))
        )));

        MarketState msImpl = new MarketState();
        marketState = MarketState(address(new ERC1967Proxy(
            address(msImpl),
            abi.encodeCall(MarketState.initialize, (admin, address(oracle)))
        )));
        marketState.registerFeed(GOLD_FEED);

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
                100e18, 10e18, 120
            ))
        )));

        pool.setP2PTrading(address(p2pTrading));
        p2pTrading.setSettlementKeeper(admin);
        vamm.setDepthMultiplier(GOLD_FEED, 1e24);
        vamm.setP2PTrading(address(p2pTrading));
        vamm.setMarketState(address(marketState));

        vm.stopPrank();

        // Open then close market
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);
        vm.warp(block.timestamp + 1);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, false);
        marketState.updateState(GOLD_FEED);

        // Initialize VAMM
        vm.prank(admin);
        vamm.initializeVAMM(GOLD_FEED, GOLD_PRICE);
    }

    function _totalSystemUSDC() internal view returns (uint256) {
        return usdc.balanceOf(user1) + usdc.balanceOf(user2) + usdc.balanceOf(user3)
            + usdc.balanceOf(address(pool)) + usdc.balanceOf(address(goldCustody))
            + usdc.balanceOf(address(p2pTrading)) + usdc.balanceOf(admin);
    }

    /// @notice Core regression test: escrow tracker must always be <= actual USDC in contract.
    /// Two traders open opposite positions, one closes for profit — subsequent close must not revert.
    function test_escrowTracker_matchesActualUSDC_afterProfitableClose() public {
        uint256 systemBefore = _totalSystemUSDC();

        // User2 opens a LONG
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 10_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 10_000e18, 10e18);
        vm.stopPrank();

        // User3 opens a SHORT
        vm.startPrank(user3);
        usdc.approve(address(p2pTrading), 10_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, false, 10_000e18, 10e18);
        vm.stopPrank();

        // Escrow should match USDC after opens
        assertEq(
            p2pTrading.p2pEscrowBalance(GOLD_FEED),
            usdc.balanceOf(address(p2pTrading)),
            "Escrow == USDC after opens"
        );

        vm.warp(block.timestamp + 121);

        // User2 closes their LONG
        bytes32 pos2 = keccak256(abi.encodePacked(user2, uint256(1), "p2p"));
        vm.prank(user2);
        p2pTrading.closeP2PPosition(pos2);

        // CRITICAL: escrow tracker must never exceed actual USDC
        uint256 escrowAfterClose = p2pTrading.p2pEscrowBalance(GOLD_FEED);
        uint256 actualUSDC = usdc.balanceOf(address(p2pTrading));
        assertLe(
            escrowAfterClose,
            actualUSDC,
            "BUG: Escrow tracker exceeds actual USDC"
        );

        // User3 must be able to close (would revert with old bug if USDC drained)
        bytes32 pos3 = keccak256(abi.encodePacked(user3, uint256(2), "p2p"));
        vm.prank(user3);
        p2pTrading.closeP2PPosition(pos3);

        // Escrow should be 0 after all positions closed
        assertEq(p2pTrading.p2pEscrowBalance(GOLD_FEED), 0, "Escrow should be zero");

        // USDC conservation
        assertEq(_totalSystemUSDC(), systemBefore, "Total USDC must be conserved");
    }

    /// @notice Three traders: first profits big, remaining two must still be able to close.
    function test_threeTraders_firstProfits_othersTwoCanStillClose() public {
        uint256 systemBefore = _totalSystemUSDC();

        // User1 opens LONG (pushes price up)
        vm.startPrank(user1);
        usdc.approve(address(p2pTrading), 5_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 5_000e18, 10e18);
        vm.stopPrank();

        // User2 opens SHORT
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 5_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, false, 5_000e18, 10e18);
        vm.stopPrank();

        // User3 opens SHORT
        vm.startPrank(user3);
        usdc.approve(address(p2pTrading), 5_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, false, 5_000e18, 10e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 121);

        // User1 closes — may profit or lose depending on VAMM dynamics
        bytes32 pos1 = keccak256(abi.encodePacked(user1, uint256(1), "p2p"));
        vm.prank(user1);
        p2pTrading.closeP2PPosition(pos1);

        // Escrow must never exceed contract balance
        assertLe(
            p2pTrading.p2pEscrowBalance(GOLD_FEED),
            usdc.balanceOf(address(p2pTrading)),
            "Escrow must not exceed USDC after first close"
        );

        // User2 closes (must not revert)
        bytes32 pos2 = keccak256(abi.encodePacked(user2, uint256(2), "p2p"));
        vm.prank(user2);
        p2pTrading.closeP2PPosition(pos2);

        assertLe(
            p2pTrading.p2pEscrowBalance(GOLD_FEED),
            usdc.balanceOf(address(p2pTrading)),
            "Escrow must not exceed USDC after second close"
        );

        // User3 closes (must not revert)
        bytes32 pos3 = keccak256(abi.encodePacked(user3, uint256(3), "p2p"));
        vm.prank(user3);
        p2pTrading.closeP2PPosition(pos3);

        // All out — check conservation
        assertEq(_totalSystemUSDC(), systemBefore, "Total USDC conserved");
        assertEq(p2pTrading.p2pEscrowBalance(GOLD_FEED), 0, "Escrow zero after all close");
    }

    /// @notice Batch settlement with profitable positions must not desync escrow
    function test_batchSettlement_escrowConsistency() public {
        uint256 systemBefore = _totalSystemUSDC();

        // User2 opens LONG
        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 5_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 5_000e18, 10e18);
        vm.stopPrank();

        // User3 opens SHORT
        vm.startPrank(user3);
        usdc.approve(address(p2pTrading), 5_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, false, 5_000e18, 10e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 200);

        // Settle at a price 10% above entry - longs profit, shorts lose
        uint256 settlePrice = GOLD_PRICE * 110 / 100;

        bytes32[] memory posIds = new bytes32[](2);
        posIds[0] = keccak256(abi.encodePacked(user2, uint256(1), "p2p"));
        posIds[1] = keccak256(abi.encodePacked(user3, uint256(2), "p2p"));

        vm.prank(admin);
        p2pTrading.settleP2PBatch(posIds, settlePrice);

        // Escrow should be consistent
        assertLe(
            p2pTrading.p2pEscrowBalance(GOLD_FEED),
            usdc.balanceOf(address(p2pTrading)),
            "Escrow <= USDC after batch settlement"
        );

        assertEq(_totalSystemUSDC(), systemBefore, "Total USDC conserved");
    }

    /// @notice Escrow tracker invariant: at every point, escrow <= contract USDC
    function test_escrowInvariant_alwaysLeThanUSDC() public {
        // Open 3 positions of different sizes
        vm.startPrank(user1);
        usdc.approve(address(p2pTrading), 20_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 3_000e18, 5e18);
        p2pTrading.openP2PPosition(GOLD_FEED, true, 7_000e18, 5e18);
        vm.stopPrank();

        vm.startPrank(user2);
        usdc.approve(address(p2pTrading), 10_000e18);
        p2pTrading.openP2PPosition(GOLD_FEED, false, 10_000e18, 5e18);
        vm.stopPrank();

        // Check after every close
        vm.warp(block.timestamp + 121);

        bytes32 p1 = keccak256(abi.encodePacked(user1, uint256(1), "p2p"));
        vm.prank(user1);
        p2pTrading.closeP2PPosition(p1);
        assertLe(p2pTrading.p2pEscrowBalance(GOLD_FEED), usdc.balanceOf(address(p2pTrading)), "After close 1");

        bytes32 p2 = keccak256(abi.encodePacked(user1, uint256(2), "p2p"));
        vm.prank(user1);
        p2pTrading.closeP2PPosition(p2);
        assertLe(p2pTrading.p2pEscrowBalance(GOLD_FEED), usdc.balanceOf(address(p2pTrading)), "After close 2");

        bytes32 p3 = keccak256(abi.encodePacked(user2, uint256(3), "p2p"));
        vm.prank(user2);
        p2pTrading.closeP2PPosition(p3);
        assertLe(p2pTrading.p2pEscrowBalance(GOLD_FEED), usdc.balanceOf(address(p2pTrading)), "After close 3");

        assertEq(p2pTrading.p2pEscrowBalance(GOLD_FEED), 0, "Escrow zero after all close");
    }
}

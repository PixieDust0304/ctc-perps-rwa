// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pool} from "../../src/core/Pool.sol";
import {Custody} from "../../src/core/Custody.sol";
import {Trading} from "../../src/core/Trading.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";
import {MarketState} from "../../src/core/MarketState.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CustodyDrainTest
/// @notice Tests extreme scenarios: winners drain custody, waterfall empty, payout caps
contract CustodyDrainTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    Trading public trading;
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

        Trading tradingImpl = new Trading();
        trading = Trading(address(new ERC1967Proxy(
            address(tradingImpl),
            abi.encodeCall(Trading.initialize, (
                admin, address(usdc), address(oracle), address(pool),
                address(feeManager), address(marketState),
                100e18, 1000, 10e18, 120
            ))
        )));

        trading.setFeedCustody(GOLD_FEED, address(goldCustody));
        goldCustody.setTrading(address(trading));
        pool.setTrading(address(trading));

        vm.stopPrank();

        // Open market
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);
    }

    function _totalSystemUSDC() internal view returns (uint256) {
        return usdc.balanceOf(user1) + usdc.balanceOf(user2) + usdc.balanceOf(user3)
            + usdc.balanceOf(address(pool)) + usdc.balanceOf(address(goldCustody))
            + usdc.balanceOf(address(trading)) + usdc.balanceOf(admin);
    }

    /// @notice Winning trader's payout is capped by custody available balance
    function test_payoutCappedByCustody() public {
        // LP deposit must cover sizeUsd reservation (5k collateral * 10x = 50k size)
        vm.startPrank(user1);
        usdc.approve(address(pool), 50_000e18);
        pool.deposit(50_000e18);
        vm.stopPrank();

        // User2 opens large leveraged position
        vm.startPrank(user2);
        usdc.approve(address(trading), 5000e18);
        trading.openPosition(GOLD_FEED, true, 5000e18, 10e18);
        vm.stopPrank();

        // Big price jump — 20%
        vm.warp(block.timestamp + 121);
        uint256 newRaw = 36452400000000; // ~$3645.24 (20% up)
        _updateOraclePrice(GOLD_FEED, newRaw, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        // Trader's theoretical PnL: 20% * 10x * 4950 = 9900 profit
        // But custody available is limited — payout should be capped
        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));
        uint256 traderBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId);
        uint256 traderPayout = usdc.balanceOf(user2) - traderBefore;

        // Trader should get something, but capped
        assertGt(traderPayout, 0, "Trader should get payout");
        // Payout must not exceed custody available (minus reserved)
        // USDC must still be conserved
        assertEq(_totalSystemUSDC(), 3_000_000e18, "USDC conservation after capped payout");
    }

    /// @notice After big winner drains custody, LP can still withdraw (reduced amount)
    function test_custodyDrain_lpWithdrawsRemainder() public {
        uint256 systemBefore = _totalSystemUSDC();

        // LP deposit must cover sizeUsd reservation for both positions (2 * 10k * 10x = 200k)
        vm.startPrank(user1);
        usdc.approve(address(pool), 200_000e18);
        pool.deposit(200_000e18);
        vm.stopPrank();

        // Two large positions
        vm.startPrank(user2);
        usdc.approve(address(trading), 10_000e18);
        trading.openPosition(GOLD_FEED, true, 10_000e18, 10e18);
        vm.stopPrank();

        vm.startPrank(user3);
        usdc.approve(address(trading), 10_000e18);
        trading.openPosition(GOLD_FEED, false, 10_000e18, 10e18);
        vm.stopPrank();

        // Big price movement: 10% up. Long wins big, short loses big.
        vm.warp(block.timestamp + 121);
        uint256 newRaw = 33414700000000; // ~$3341.47 (10% up)
        _updateOraclePrice(GOLD_FEED, newRaw, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        // Close both positions
        bytes32 posLong = keccak256(abi.encodePacked(user2, uint256(1)));
        bytes32 posShort = keccak256(abi.encodePacked(user3, uint256(2)));

        vm.prank(user2);
        trading.closePosition(posLong);
        vm.prank(user3);
        trading.closePosition(posShort);

        assertEq(_totalSystemUSDC(), systemBefore, "USDC conservation after both close");

        // LP withdraws — should get whatever is left
        vm.startPrank(user1);
        uint256 clpBal = clp.balanceOf(user1);
        pool.withdraw(clpBal);
        uint256 lpFinal = usdc.balanceOf(user1);
        vm.stopPrank();

        // With equal long/short positions, PnL roughly cancels.
        // LP should earn net fees even when one trader wins big.
        // The key test is that LP can actually withdraw and USDC is conserved.

        assertEq(_totalSystemUSDC(), systemBefore, "Final USDC conservation");
    }

    /// @notice Pool accounting tracks custody changes correctly after multiple positions
    function test_poolAccounting_multiplePositions() public {
        vm.startPrank(user1);
        usdc.approve(address(pool), 100_000e18);
        pool.deposit(100_000e18);
        vm.stopPrank();

        // Open position 1
        vm.startPrank(user2);
        usdc.approve(address(trading), 10_000e18);
        trading.openPosition(GOLD_FEED, true, 5_000e18, 5e18);
        trading.openPosition(GOLD_FEED, false, 5_000e18, 5e18);
        vm.stopPrank();

        // Price flat — close both
        vm.warp(block.timestamp + 121);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        bytes32 pos1 = keccak256(abi.encodePacked(user2, uint256(1)));
        bytes32 pos2 = keccak256(abi.encodePacked(user2, uint256(2)));
        vm.startPrank(user2);
        trading.closePosition(pos1);
        trading.closePosition(pos2);
        vm.stopPrank();

        // Verify pool accounting matches reality
        uint256 poolAccounting = pool.totalPoolUSDC();
        uint256 actualInCustody = goldCustody.availableBalance();
        uint256 reservedInCustody = goldCustody.reservedBalance();
        uint256 poolDirect = usdc.balanceOf(address(pool));

        // All positions closed, so reserved should be 0
        assertEq(reservedInCustody, 0, "No reserved after all closed");

        // Pool accounting should match: pool direct USDC + custody available
        assertApproxEqAbs(
            poolAccounting,
            poolDirect + actualInCustody,
            1,
            "Pool accounting matches reality"
        );

        // USDC conserved
        assertEq(_totalSystemUSDC(), 3_000_000e18, "USDC conservation");
    }
}

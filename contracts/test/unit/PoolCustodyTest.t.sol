// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pool} from "../../src/core/Pool.sol";
import {Custody} from "../../src/core/Custody.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";
import {MarketState} from "../../src/core/MarketState.sol";
import {WaterfallWithdraw} from "../../src/libraries/WaterfallWithdraw.sol";

contract PoolCustodyTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    Custody public silverCustody;
    Custody public crudeOilCustody;
    Custody public platinumCustody;
    FeeManager public feeManager;
    MarketState public marketState;

    function setUp() public override {
        super.setUp();

        vm.startPrank(admin);

        // Deploy Pool
        Pool poolImpl = new Pool();
        bytes memory poolInit = abi.encodeCall(
            Pool.initialize,
            (admin, address(usdc), address(clp), admin, 9000)
        );
        pool = Pool(address(new ERC1967Proxy(address(poolImpl), poolInit)));

        // Transfer CLP ownership to Pool (so Pool can mint/burn)
        clp.transferOwnership(address(pool));

        // Deploy 4 Custodies
        goldCustody = _deployCustody(GOLD_FEED);
        silverCustody = _deployCustody(SILVER_FEED);
        crudeOilCustody = _deployCustody(CRUDE_OIL_FEED);
        platinumCustody = _deployCustody(PLATINUM_FEED);

        // Add custodies to pool (equal 25% allocation each)
        pool.addCustody(address(goldCustody), 2500);
        pool.addCustody(address(silverCustody), 2500);
        pool.addCustody(address(crudeOilCustody), 2500);
        pool.addCustody(address(platinumCustody), 2500);

        // Deploy FeeManager
        FeeManager feeManagerImpl = new FeeManager();
        bytes memory fmInit = abi.encodeCall(
            FeeManager.initialize,
            (admin, 10, 5, 5, 9000) // 0.1% open/close, 0.05% max base/hr, 0.05% max funding/hr, 90% LP
        );
        feeManager = FeeManager(address(new ERC1967Proxy(address(feeManagerImpl), fmInit)));

        // Deploy MarketState
        MarketState msImpl = new MarketState();
        bytes memory msInit = abi.encodeCall(MarketState.initialize, (admin, address(oracle)));
        marketState = MarketState(address(new ERC1967Proxy(address(msImpl), msInit)));

        marketState.registerFeed(GOLD_FEED);
        marketState.registerFeed(SILVER_FEED);
        marketState.registerFeed(CRUDE_OIL_FEED);
        marketState.registerFeed(PLATINUM_FEED);

        vm.stopPrank();
    }

    function _deployCustody(uint16 feedId_) internal returns (Custody) {
        Custody impl = new Custody();
        bytes memory init = abi.encodeCall(
            Custody.initialize,
            (admin, feedId_, address(usdc), address(pool), 5, 5)
        );
        return Custody(address(new ERC1967Proxy(address(impl), init)));
    }

    // === Pool Deposit Tests ===

    function test_deposit_firstDeposit() public {
        vm.startPrank(user1);
        usdc.approve(address(pool), 10000e18);
        pool.deposit(10000e18);
        vm.stopPrank();

        // 1:1 CLP for first deposit
        assertEq(clp.balanceOf(user1), 10000e18);
        assertEq(pool.totalPoolUSDC(), 10000e18);

        // Each custody gets 25%
        assertEq(goldCustody.availableBalance(), 2500e18);
        assertEq(silverCustody.availableBalance(), 2500e18);
        assertEq(crudeOilCustody.availableBalance(), 2500e18);
        assertEq(platinumCustody.availableBalance(), 2500e18);
    }

    function test_deposit_secondDeposit_proportional() public {
        // First deposit
        vm.startPrank(user1);
        usdc.approve(address(pool), 10000e18);
        pool.deposit(10000e18);
        vm.stopPrank();

        // Second deposit: same amount should get same CLP
        vm.startPrank(user2);
        usdc.approve(address(pool), 10000e18);
        pool.deposit(10000e18);
        vm.stopPrank();

        assertEq(clp.balanceOf(user2), 10000e18);
        assertEq(pool.totalPoolUSDC(), 20000e18);
    }

    function test_withdraw_full() public {
        // Deposit
        vm.startPrank(user1);
        usdc.approve(address(pool), 10000e18);
        pool.deposit(10000e18);

        uint256 balBefore = usdc.balanceOf(user1);

        // Withdraw all
        pool.withdraw(10000e18);
        vm.stopPrank();

        uint256 balAfter = usdc.balanceOf(user1);
        assertEq(balAfter - balBefore, 10000e18);
        assertEq(clp.balanceOf(user1), 0);
        assertEq(pool.totalPoolUSDC(), 0);
    }

    function test_withdraw_partial() public {
        vm.startPrank(user1);
        usdc.approve(address(pool), 10000e18);
        pool.deposit(10000e18);

        // Withdraw 50%
        pool.withdraw(5000e18);
        vm.stopPrank();

        assertEq(clp.balanceOf(user1), 5000e18);
        assertEq(pool.totalPoolUSDC(), 5000e18);
    }

    function test_deposit_zeroReverts() public {
        vm.prank(user1);
        vm.expectRevert("Pool: zero amount");
        pool.deposit(0);
    }

    function test_withdraw_zeroReverts() public {
        vm.prank(user1);
        vm.expectRevert("Pool: zero amount");
        pool.withdraw(0);
    }

    // === Custody Tests ===

    function test_custody_feedId() public view {
        assertEq(goldCustody.feedId(), GOLD_FEED);
        assertEq(silverCustody.feedId(), SILVER_FEED);
    }

    function test_custody_onlyPool_addLiquidity() public {
        vm.prank(user1);
        vm.expectRevert("Custody: not pool");
        goldCustody.addLiquidity(100e18);
    }

    // === FeeManager Tests ===

    function test_feeManager_openCloseFee() public view {
        // 0.1% of $100,000 notional = $100
        uint256 fee = feeManager.calculateOpenCloseFee(100_000e18);
        assertEq(fee, 100e18);
    }

    function test_feeManager_splitFee() public view {
        (uint256 lpFee, uint256 protocolFee) = feeManager.splitFee(100e18);
        assertEq(lpFee, 90e18);
        assertEq(protocolFee, 10e18);
    }

    // === MarketState Tests ===

    function test_marketState_initiallyClose() public view {
        assertFalse(marketState.isMarketOpen(GOLD_FEED));
    }

    function test_marketState_opensOnFreshPrice() public {
        uint256 ts = block.timestamp;
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts, true);

        marketState.updateState(GOLD_FEED);
        assertTrue(marketState.isMarketOpen(GOLD_FEED));
    }

    function test_marketState_closesOnStalePrice() public {
        uint256 ts = block.timestamp;
        // First open it
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts, true);
        marketState.updateState(GOLD_FEED);
        assertTrue(marketState.isMarketOpen(GOLD_FEED));

        // Now close it
        _updateOraclePrice(GOLD_FEED, 30377000000000, ts + 1, false);
        marketState.updateState(GOLD_FEED);
        assertFalse(marketState.isMarketOpen(GOLD_FEED));
    }

    // === Waterfall Withdraw Test ===

    function test_waterfall_uneven_balances() public {
        // Deposit to create balances
        vm.startPrank(user1);
        usdc.approve(address(pool), 40000e18);
        pool.deposit(40000e18);
        vm.stopPrank();

        // Each custody has 10000e18
        // Now simulate one custody being partially drained (by admin moving allocation)
        // We just test the waterfall math directly
        uint256[] memory balances = new uint256[](4);
        balances[0] = 1000e18;   // Gold: low
        balances[1] = 5000e18;   // Silver: medium
        balances[2] = 15000e18;  // CrudeOil: high
        balances[3] = 19000e18;  // Platinum: high

        uint256[] memory amounts = WaterfallWithdraw.calculate(8000e18, balances);

        // Should distribute proportionally with waterfall
        uint256 total;
        for (uint256 i = 0; i < 4; i++) {
            total += amounts[i];
            assertLe(amounts[i], balances[i], "Cannot withdraw more than available");
        }
        assertApproxEqAbs(total, 8000e18, 4); // Allow tiny rounding from integer division
    }

    function test_waterfall_insufficient_reverts() public {
        uint256[] memory balances = new uint256[](2);
        balances[0] = 100e18;
        balances[1] = 100e18;

        // Library reverts inline, test via wrapper
        WaterfallWrapper wrapper = new WaterfallWrapper();
        vm.expectRevert("Waterfall: insufficient liquidity");
        wrapper.calculate(300e18, balances);
    }
}

contract WaterfallWrapper {
    function calculate(uint256 total, uint256[] memory balances) external pure returns (uint256[] memory) {
        return WaterfallWithdraw.calculate(total, balances);
    }
}

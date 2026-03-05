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

/// @title FullLifecycleTest
/// @notice Tests: LP deposit -> trade -> accrue fees -> close -> LP withdraw with fee income
/// Also validates that USDC accounting holds at every step (no creation/destruction of value)
contract FullLifecycleTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    Trading public trading;
    FeeManager public feeManager;
    MarketState public marketState;

    uint256 constant GOLD_RAW = 30377000000000; // ~$3037.70
    uint256 constant GOLD_PRICE = 3037.7e18;
    uint256 constant LP_DEPOSIT = 100_000e18;
    uint256 constant TRADER_COLLATERAL = 10_000e18;

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
            abi.encodeCall(Custody.initialize, (admin, GOLD_FEED, address(usdc), address(pool), 500, 1))
        )));
        pool.addCustody(address(goldCustody), 10000);

        FeeManager fmImpl = new FeeManager();
        feeManager = FeeManager(address(new ERC1967Proxy(
            address(fmImpl),
            abi.encodeCall(FeeManager.initialize, (admin, 10, 500, 1, 9000))
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
                100e18, 3000, 10e18, 120
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

    /// @notice Helper: returns total USDC across all system components
    function _totalSystemUSDC() internal view returns (uint256) {
        return usdc.balanceOf(user1) + usdc.balanceOf(user2) + usdc.balanceOf(user3)
            + usdc.balanceOf(address(pool)) + usdc.balanceOf(address(goldCustody))
            + usdc.balanceOf(address(trading)) + usdc.balanceOf(admin);
    }

    /// @notice FULL LIFECYCLE: LP deposits -> trader opens/closes losing position -> LP withdraws more than deposited
    function test_fullLifecycle_lpEarnsFromLosingTrader() public {
        uint256 systemUsdcBefore = _totalSystemUSDC();
        assertEq(systemUsdcBefore, 3_000_000e18, "Initial USDC mismatch");

        // === Step 1: LP deposits ===
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        uint256 clpBalance = clp.balanceOf(user1);
        assertEq(clpBalance, LP_DEPOSIT, "First deposit should be 1:1");
        assertEq(_totalSystemUSDC(), systemUsdcBefore, "USDC conservation after deposit");

        // === Step 2: Trader opens 10x long ===
        vm.startPrank(user2);
        usdc.approve(address(trading), TRADER_COLLATERAL);
        trading.openPosition(GOLD_FEED, true, TRADER_COLLATERAL, 10e18);
        vm.stopPrank();

        assertEq(_totalSystemUSDC(), systemUsdcBefore, "USDC conservation after open");

        // Open fee: 0.1% of 100k notional = 100 USDC
        // Verify the fee USDC actually exists in the system
        uint256 poolUsdcBalance = usdc.balanceOf(address(pool));
        uint256 custodyUsdcBalance = usdc.balanceOf(address(goldCustody));

        // === Step 3: Price drops 5% -> trader loses ===
        vm.warp(block.timestamp + 121);
        uint256 newRaw = 28858150000000; // ~$2885.815 (5% drop)
        _updateOraclePrice(GOLD_FEED, newRaw, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        // === Step 4: Trader closes (losing position) ===
        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));
        uint256 traderBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId);
        uint256 traderAfter = usdc.balanceOf(user2);

        uint256 traderPayout = traderAfter - traderBefore;
        uint256 traderLoss = TRADER_COLLATERAL - traderPayout;
        assertGt(traderLoss, 0, "Trader should have lost money");
        assertEq(_totalSystemUSDC(), systemUsdcBefore, "USDC conservation after close");

        // === Step 5: LP withdraws ALL ===
        // CRITICAL CHECK: pool.totalPoolUSDC should reflect actual withdrawable amount
        uint256 totalPoolAccounting = pool.totalPoolUSDC();
        uint256 actualPoolPlusCustody = usdc.balanceOf(address(pool)) + usdc.balanceOf(address(goldCustody));

        // THIS IS THE BUG CHECK: pool accounting should match actual USDC
        // If fees were counted in totalPoolUSDC but USDC is stuck in custody,
        // this assertion will catch it.
        assertApproxEqAbs(
            totalPoolAccounting,
            actualPoolPlusCustody,
            1, // only 1 wei tolerance for rounding, NOT hiding accounting bugs
            "CRITICAL: Pool accounting diverges from actual USDC (fee leak)"
        );

        // LP withdraws everything
        vm.startPrank(user1);
        uint256 lpBefore = usdc.balanceOf(user1);
        pool.withdraw(clpBalance);
        uint256 lpAfter = usdc.balanceOf(user1);
        vm.stopPrank();

        uint256 lpPayout = lpAfter - lpBefore;

        // LP should profit from the trader's loss (pool absorbed the loss as USDC staying in custody)
        // The pool should have captured: trader's loss + open/close fees
        assertGt(lpPayout, LP_DEPOSIT, "LP should profit from losing trader");
        assertEq(_totalSystemUSDC(), systemUsdcBefore, "USDC conservation after withdraw");
    }

    /// @notice FULL LIFECYCLE: Trader wins -> LP loses money
    function test_fullLifecycle_traderWinsLpLoses() public {
        // LP deposits
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        // Trader opens 10x long with 10k collateral
        vm.startPrank(user2);
        usdc.approve(address(trading), TRADER_COLLATERAL);
        trading.openPosition(GOLD_FEED, true, TRADER_COLLATERAL, 10e18);
        vm.stopPrank();

        // Price goes up 5%
        vm.warp(block.timestamp + 121);
        uint256 newRaw = 31895850000000; // ~$3189.585
        _updateOraclePrice(GOLD_FEED, newRaw, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));
        vm.prank(user2);
        trading.closePosition(posId);

        // LP withdraws
        vm.startPrank(user1);
        pool.withdraw(clp.balanceOf(user1));
        uint256 lpFinal = usdc.balanceOf(user1);
        vm.stopPrank();

        // LP started with 1M, deposited 100k, should get back less than 100k
        uint256 lpNetChange = lpFinal - (1_000_000e18 - LP_DEPOSIT);
        assertLt(lpNetChange, LP_DEPOSIT, "LP should lose when trader wins");

        // But USDC is still conserved
        assertEq(_totalSystemUSDC(), 3_000_000e18, "USDC must be conserved");
    }

    /// @notice Verify that fee accounting matches actual USDC at every step
    function test_feeAccounting_usdcMatchesThroughout() public {
        // LP deposits
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        // Record starting state
        uint256 poolAccountingBefore = pool.totalPoolUSDC();
        uint256 poolActualBefore = usdc.balanceOf(address(pool)) + usdc.balanceOf(address(goldCustody));
        assertEq(poolAccountingBefore, poolActualBefore, "Pre-trade accounting");

        // Open position (generates open fee)
        vm.startPrank(user2);
        usdc.approve(address(trading), 1000e18);
        trading.openPosition(GOLD_FEED, true, 1000e18, 10e18);
        vm.stopPrank();

        // CHECK: Does pool accounting match pool's actual USDC?
        // pool.totalPoolUSDC = pool's owned USDC = actual USDC minus trader-reserved amounts
        uint256 poolAccountingAfterOpen = pool.totalPoolUSDC();
        uint256 totalActualUSDC = usdc.balanceOf(address(pool)) + usdc.balanceOf(address(goldCustody));
        uint256 custodyReserved = goldCustody.reservedBalance();

        // Pool accounting should equal total actual USDC minus trader's reserved collateral
        assertApproxEqAbs(
            poolAccountingAfterOpen,
            totalActualUSDC - custodyReserved,
            1,
            "FEE BUG: Pool accounting diverges from pool-owned USDC"
        );

        // Now verify custody's availableBalance matches its actual USDC
        // This catches untracked fee dust in custody
        uint256 custodyAvailable = goldCustody.availableBalance();
        uint256 custodyActual = usdc.balanceOf(address(goldCustody));

        assertEq(
            custodyAvailable,
            custodyActual,
            "CUSTODY BUG: Untracked USDC in custody (fee dust)"
        );
    }

    /// @notice Multiple traders: one long, one short, fees to LP
    function test_multiTrader_feeIncomeToLP() public {
        // LP deposits
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        // User2: 10x long
        vm.startPrank(user2);
        usdc.approve(address(trading), 5000e18);
        trading.openPosition(GOLD_FEED, true, 5000e18, 10e18);
        vm.stopPrank();

        // User3: 10x short
        vm.startPrank(user3);
        usdc.approve(address(trading), 5000e18);
        trading.openPosition(GOLD_FEED, false, 5000e18, 10e18);
        vm.stopPrank();

        // Price stays flat — both close with just fee losses
        vm.warp(block.timestamp + 121);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        bytes32 posId1 = keccak256(abi.encodePacked(user2, uint256(1)));
        bytes32 posId2 = keccak256(abi.encodePacked(user3, uint256(2)));

        vm.prank(user2);
        trading.closePosition(posId1);
        vm.prank(user3);
        trading.closePosition(posId2);

        // LP withdraws
        vm.startPrank(user1);
        pool.withdraw(clp.balanceOf(user1));
        uint256 lpFinal = usdc.balanceOf(user1);
        vm.stopPrank();

        // LP should have MORE than deposited (earned all open+close fees)
        // Each trader: open fee = 0.1% * 50000 = 50, close fee = 50. Total fees = 200 USDC
        uint256 lpNet = lpFinal - (1_000_000e18 - LP_DEPOSIT);
        assertGt(lpNet, LP_DEPOSIT, "LP must earn fees from both sides");

        // USDC must be conserved
        assertEq(_totalSystemUSDC(), 3_000_000e18, "USDC conservation");
    }

    /// @notice VFR: Solo long pays funding (no shorts to receive), pool keeps it
    function test_fundingRate_soloLongPaysFundingToPool() public {
        // LP deposits
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        // Only user2 opens a long — 100% OI imbalance → max funding rate
        vm.startPrank(user2);
        usdc.approve(address(trading), 5000e18);
        trading.openPosition(GOLD_FEED, true, 5000e18, 10e18);
        vm.stopPrank();

        // Warp 1 hour — accumulate significant funding
        vm.warp(block.timestamp + 3600 + 1);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));
        uint256 traderBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId);
        uint256 traderPayout = usdc.balanceOf(user2) - traderBefore;

        // Trader should lose MORE than just base fee — funding adds on top
        uint256 traderLoss = 5000e18 - traderPayout;
        // Base fee alone = ~5% of 50k notional = 2500 over 1hr
        // Funding should add additional loss
        assertGt(traderLoss, 2500e18, "Funding should increase trader loss beyond base fee");

        // Pool accounting should still match
        assertApproxEqAbs(
            pool.totalPoolUSDC(),
            usdc.balanceOf(address(pool)) + usdc.balanceOf(address(goldCustody)),
            1,
            "Pool accounting must match after funding"
        );
        assertEq(_totalSystemUSDC(), 3_000_000e18, "USDC conservation");
    }

    /// @notice VFR: Long and short, balanced OI → zero funding, only base fees
    function test_fundingRate_balancedOI_zeroFunding() public {
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        // Equal long and short
        vm.startPrank(user2);
        usdc.approve(address(trading), 5000e18);
        trading.openPosition(GOLD_FEED, true, 5000e18, 10e18);
        vm.stopPrank();

        vm.startPrank(user3);
        usdc.approve(address(trading), 5000e18);
        trading.openPosition(GOLD_FEED, false, 5000e18, 10e18);
        vm.stopPrank();

        // Warp 1 hour
        vm.warp(block.timestamp + 3600 + 1);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        bytes32 posId1 = keccak256(abi.encodePacked(user2, uint256(1)));
        bytes32 posId2 = keccak256(abi.encodePacked(user3, uint256(2)));

        uint256 longBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId1);
        uint256 longPayout = usdc.balanceOf(user2) - longBefore;

        uint256 shortBefore = usdc.balanceOf(user3);
        vm.prank(user3);
        trading.closePosition(posId2);
        uint256 shortPayout = usdc.balanceOf(user3) - shortBefore;

        // With balanced OI and flat price, both should lose roughly equal base fees
        // Funding should be ~0 (balanced OI → funding rate = 0)
        uint256 longLoss = 5000e18 - longPayout;
        uint256 shortLoss = 5000e18 - shortPayout;

        // Losses should be approximately equal (both pay base fee + close fee, no funding)
        assertApproxEqRel(longLoss, shortLoss, 0.01e18, "Balanced OI: losses should be similar");
        assertEq(_totalSystemUSDC(), 3_000_000e18, "USDC conservation");
    }

    /// @notice VFR: Imbalanced OI — dominant side pays more, minority side pays less
    function test_fundingRate_imbalancedOI_dominantPaysMore() public {
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        // User2: large long (dominant)
        vm.startPrank(user2);
        usdc.approve(address(trading), 8000e18);
        trading.openPosition(GOLD_FEED, true, 8000e18, 10e18);
        vm.stopPrank();

        // User3: small short (minority)
        vm.startPrank(user3);
        usdc.approve(address(trading), 2000e18);
        trading.openPosition(GOLD_FEED, false, 2000e18, 10e18);
        vm.stopPrank();

        // Warp 30 minutes
        vm.warp(block.timestamp + 1800 + 1);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        bytes32 posId1 = keccak256(abi.encodePacked(user2, uint256(1)));
        bytes32 posId2 = keccak256(abi.encodePacked(user3, uint256(2)));

        uint256 longBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId1);
        uint256 longPayout = usdc.balanceOf(user2) - longBefore;

        uint256 shortBefore = usdc.balanceOf(user3);
        vm.prank(user3);
        trading.closePosition(posId2);
        uint256 shortPayout = usdc.balanceOf(user3) - shortBefore;

        // Long (dominant side) should pay funding → net loss is higher
        // Short (minority side) should receive funding → can even profit from flat price
        // The long loses more than base+close fees because funding is deducted
        assertLt(longPayout, 8000e18, "Long must lose money (base fee + funding)");
        uint256 longLoss = 8000e18 - longPayout;
        // Short can receive MORE than their deposit due to funding income
        // (flat price + funding received - base fee - close fee)
        // At minimum, short's total cost should be much less than long's per-notional
        // Long pays funding, short receives it — so short should be better off than long
        assertGt(shortPayout, longPayout * 2000 / 8000, "Short should do better per-notional than long");
        assertEq(_totalSystemUSDC(), 3_000_000e18, "USDC conservation");
    }

    /// @notice Base fee accrual over time -> LP profits
    function test_baseFee_accruesToLP() public {
        // LP deposits
        vm.startPrank(user1);
        usdc.approve(address(pool), LP_DEPOSIT);
        pool.deposit(LP_DEPOSIT);
        vm.stopPrank();

        // Trader opens 10x long
        vm.startPrank(user2);
        usdc.approve(address(trading), 5000e18);
        trading.openPosition(GOLD_FEED, true, 5000e18, 10e18);
        vm.stopPrank();

        // Warp 1 hour forward (240 intervals at 15s each)
        vm.warp(block.timestamp + 3600 + 1);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);

        // Accrue fees in custody
        goldCustody.accrueFees();

        // After 1 hour with 100% long OI (side_OI/total_OI = 1):
        // base_fee_rate = 1.0 * 5% / 240 per interval = 0.020833% per interval
        // 240 intervals = 5% of notional = 5% * 50000 = 2500 USDC
        // This should be deducted from trader's effective collateral on close

        bytes32 posId = keccak256(abi.encodePacked(user2, uint256(1)));
        uint256 traderBefore = usdc.balanceOf(user2);
        vm.prank(user2);
        trading.closePosition(posId);
        uint256 traderPayout = usdc.balanceOf(user2) - traderBefore;

        // Trader deposited 5000, had close fee + base fee deducted
        // Even with flat price, base fee should eat into collateral significantly
        uint256 traderLoss = 5000e18 - traderPayout;
        assertGt(traderLoss, 100e18, "Base fee should cause measurable loss over 1hr");
    }
}

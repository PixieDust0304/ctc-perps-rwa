// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pool} from "../../src/core/Pool.sol";
import {Custody} from "../../src/core/Custody.sol";
import {MockUSDC} from "../../src/tokens/MockUSDC.sol";
import {CLP} from "../../src/tokens/CLP.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Vm} from "forge-std/Vm.sol";

/// @title PoolHandler — guides invariant test random calls for Pool
contract PoolHandler {
    Pool public pool;
    Custody public custody;
    MockUSDC public usdc;
    CLP public clp;
    address[] public actors;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    constructor(
        Pool pool_,
        Custody custody_,
        MockUSDC usdc_,
        CLP clp_,
        address[] memory actors_
    ) {
        pool = pool_;
        custody = custody_;
        usdc = usdc_;
        clp = clp_;
        actors = actors_;
    }

    function deposit(uint256 actorIdx, uint256 amount) external {
        actorIdx = bound(actorIdx, 0, actors.length - 1);
        amount = bound(amount, 100e18, 100_000e18);

        address actor = actors[actorIdx];
        if (usdc.balanceOf(actor) < amount) return;

        vm.startPrank(actor);
        usdc.approve(address(pool), amount);
        try pool.deposit(amount) {
            totalDeposited += amount;
        } catch {}
        vm.stopPrank();
    }

    function withdraw(uint256 actorIdx, uint256 clpAmount) external {
        actorIdx = bound(actorIdx, 0, actors.length - 1);
        address actor = actors[actorIdx];

        uint256 maxClp = clp.balanceOf(actor);
        if (maxClp == 0) return;
        clpAmount = bound(clpAmount, 1, maxClp);

        vm.startPrank(actor);
        try pool.withdraw(clpAmount) {
            // Track approximate withdrawal
        } catch {}
        vm.stopPrank();
    }

    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function bound(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        if (min > max) return min;
        if (x < min) return min;
        if (x > max) return max;
        return min + (x % (max - min + 1));
    }
}

contract PoolInvariantTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    Custody public silverCustody;
    PoolHandler public handler;

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

        // Deploy 2 custodies
        Custody custImpl = new Custody();
        goldCustody = Custody(address(new ERC1967Proxy(
            address(custImpl),
            abi.encodeCall(Custody.initialize, (admin, GOLD_FEED, address(usdc), address(pool), 5, 5))
        )));

        Custody custImpl2 = new Custody();
        silverCustody = Custody(address(new ERC1967Proxy(
            address(custImpl2),
            abi.encodeCall(Custody.initialize, (admin, SILVER_FEED, address(usdc), address(pool), 5, 5))
        )));

        pool.addCustody(address(goldCustody), 5000);
        pool.addCustody(address(silverCustody), 5000);

        vm.stopPrank();

        address[] memory actors = new address[](3);
        actors[0] = user1;
        actors[1] = user2;
        actors[2] = user3;

        handler = new PoolHandler(pool, goldCustody, usdc, clp, actors);
        targetContract(address(handler));
    }

    /// @notice USDC conservation: total user USDC + pool USDC + custody USDC = 3M (initial mint)
    function invariant_usdcTotalConserved() public view {
        uint256 total = usdc.balanceOf(user1) + usdc.balanceOf(user2) + usdc.balanceOf(user3)
            + usdc.balanceOf(address(pool))
            + usdc.balanceOf(address(goldCustody))
            + usdc.balanceOf(address(silverCustody))
            + usdc.balanceOf(admin);

        assertEq(total, 3_000_000e18, "USDC total not conserved");
    }

    /// @notice CLP supply correlates with pool deposits: if CLP > 0, pool USDC > 0
    function invariant_clpSupplyMatchesPool() public view {
        if (clp.totalSupply() > 0) {
            assertGt(pool.totalPoolUSDC(), 0, "CLP exists but pool empty");
        }
        if (pool.totalPoolUSDC() == 0) {
            assertEq(clp.totalSupply(), 0, "Pool empty but CLP exists");
        }
    }

    /// @notice Custody available balance must be >= 0 and consistent with actual USDC balance
    function invariant_custodyBalanceConsistency() public view {
        uint256 goldActual = usdc.balanceOf(address(goldCustody));
        uint256 goldAccounting = goldCustody.availableBalance();
        // Accounting should not exceed actual (could be less if some USDC moved)
        assertLe(goldAccounting, goldActual + 1, "Gold custody accounting exceeds actual balance");

        uint256 silverActual = usdc.balanceOf(address(silverCustody));
        uint256 silverAccounting = silverCustody.availableBalance();
        assertLe(silverAccounting, silverActual + 1, "Silver custody accounting exceeds actual balance");
    }

    /// @notice Pool totalPoolUSDC should approximate actual USDC across pool + custodies
    function invariant_poolTotalApproximate() public view {
        uint256 actualTotal = usdc.balanceOf(address(pool))
            + usdc.balanceOf(address(goldCustody))
            + usdc.balanceOf(address(silverCustody));

        // totalPoolUSDC tracks deposits/withdrawals; allow small rounding difference
        if (pool.totalPoolUSDC() > 0) {
            assertApproxEqAbs(
                pool.totalPoolUSDC(),
                actualTotal,
                10, // 10 wei tolerance for rounding
                "Pool accounting diverged from actual USDC"
            );
        }
    }
}

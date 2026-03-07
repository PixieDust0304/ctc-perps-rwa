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
import {MockUSDC} from "../../src/tokens/MockUSDC.sol";

import {Vm} from "forge-std/Vm.sol";

/// @title P2PHandler — guides invariant test for P2P escrow
contract P2PHandler {
    P2PTrading public p2pTrading;
    Pool public pool;
    MockUSDC public usdc;
    VAMM public vamm;
    address[] public actors;
    uint16 public feedId;

    uint256 public totalCollateralIn;
    uint256 public openPositionCount;
    uint256 public closedPositionCount;

    // Track position IDs and their owners for closing
    bytes32[] public positionIds;
    mapping(bytes32 => address) public positionOwners;

    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    constructor(
        P2PTrading p2pTrading_,
        Pool pool_,
        MockUSDC usdc_,
        VAMM vamm_,
        address[] memory actors_,
        uint16 feedId_
    ) {
        p2pTrading = p2pTrading_;
        pool = pool_;
        usdc = usdc_;
        vamm = vamm_;
        actors = actors_;
        feedId = feedId_;
    }

    function openLong(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 100e18, 5000e18);

        vm.startPrank(actor);
        usdc.approve(address(p2pTrading), amount);
        uint256 counterBefore = p2pTrading.positionCounter();
        try p2pTrading.openP2PPosition(feedId, true, amount) {
            totalCollateralIn += amount;
            openPositionCount++;
            bytes32 posId = keccak256(abi.encodePacked(actor, counterBefore + 1, "p2p"));
            positionIds.push(posId);
            positionOwners[posId] = actor;
        } catch {}
        vm.stopPrank();
    }

    function openShort(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 100e18, 5000e18);

        vm.startPrank(actor);
        usdc.approve(address(p2pTrading), amount);
        uint256 counterBefore = p2pTrading.positionCounter();
        try p2pTrading.openP2PPosition(feedId, false, amount) {
            totalCollateralIn += amount;
            openPositionCount++;
            bytes32 posId = keccak256(abi.encodePacked(actor, counterBefore + 1, "p2p"));
            positionIds.push(posId);
            positionOwners[posId] = actor;
        } catch {}
        vm.stopPrank();
    }

    function closePosition(uint256 indexSeed) public {
        if (positionIds.length == 0) return;
        uint256 idx = indexSeed % positionIds.length;
        bytes32 posId = positionIds[idx];
        address owner = positionOwners[posId];
        if (owner == address(0)) return;

        // Warp past min open time
        vm.warp(block.timestamp + 121);

        vm.startPrank(owner);
        try p2pTrading.closeP2PPosition(posId) {
            closedPositionCount++;
            // Remove from tracking by swapping with last
            positionOwners[posId] = address(0);
            positionIds[idx] = positionIds[positionIds.length - 1];
            positionIds.pop();
        } catch {}
        vm.stopPrank();
    }

    function bound(uint256 val, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + (val % (hi - lo + 1));
    }
}

/// @title P2PInvariantTest
contract P2PInvariantTest is TestSetup {
    Pool public pool;
    Custody public goldCustody;
    P2PTrading public p2pTrading;
    VAMM public vamm;
    FeeManager public feeManager;
    MarketState public marketState;
    P2PHandler public handler;

    uint256 constant GOLD_RAW = 30377000000000;
    uint256 constant GOLD_PRICE = 3037.7e18;

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

        VAMM vammImpl = new VAMM();
        vamm = VAMM(address(new ERC1967Proxy(
            address(vammImpl),
            abi.encodeCall(VAMM.initialize, (admin))
        )));
        vamm.setDepthMultiplier(GOLD_FEED, 1e24);

        P2PTrading p2pImpl = new P2PTrading();
        p2pTrading = P2PTrading(address(new ERC1967Proxy(
            address(p2pImpl),
            abi.encodeCall(P2PTrading.initialize, (
                admin, address(usdc), address(vamm), address(pool),
                address(marketState), address(feeManager),
                10e18, 120
            ))
        )));
        vamm.setP2PTrading(address(p2pTrading));
        pool.setP2PTrading(address(p2pTrading));

        vm.stopPrank();

        // Set initial price, then close market
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp, true);
        marketState.updateState(GOLD_FEED);
        _updateOraclePrice(GOLD_FEED, GOLD_RAW, block.timestamp + 1, false);
        marketState.updateState(GOLD_FEED);

        // Initialize VAMM
        vm.prank(admin);
        vamm.initializeVAMM(GOLD_FEED, GOLD_PRICE);

        // Set up handler
        address[] memory actors = new address[](3);
        actors[0] = user1;
        actors[1] = user2;
        actors[2] = user3;
        handler = new P2PHandler(p2pTrading, pool, usdc, vamm, actors, GOLD_FEED);

        targetContract(address(handler));
    }

    /// @notice P2P escrow tracker must never exceed actual USDC in contract
    /// After closes, losing positions leave residual USDC (escrow < actual), which is fine.
    /// But escrow > actual would mean the contract can't pay out all tracked obligations.
    function invariant_escrowBackedByUSDC() public view {
        uint256 escrowTracked = p2pTrading.p2pEscrowBalance(GOLD_FEED);
        uint256 actualUSDC = usdc.balanceOf(address(p2pTrading));

        assertLe(
            escrowTracked,
            actualUSDC,
            "P2P escrow tracking must not exceed actual USDC held"
        );
    }

    /// @notice Total USDC is always conserved
    function invariant_usdcConserved() public view {
        uint256 total = usdc.balanceOf(user1) + usdc.balanceOf(user2) + usdc.balanceOf(user3)
            + usdc.balanceOf(address(pool)) + usdc.balanceOf(address(p2pTrading))
            + usdc.balanceOf(address(goldCustody)) + usdc.balanceOf(admin);

        assertEq(total, 3_000_000e18, "USDC conservation in P2P");
    }

    /// @notice OI tracking stays consistent
    function invariant_oiNonNegative() public view {
        // OI should always be >= 0 (uint256 underflow would revert, so just verify they're reasonable)
        uint256 longOI = p2pTrading.p2pLongOI(GOLD_FEED);
        uint256 shortOI = p2pTrading.p2pShortOI(GOLD_FEED);

        // OI should be bounded by total collateral (spot, no leverage)
        assertLe(longOI, handler.totalCollateralIn(), "Long OI bounded");
        assertLe(shortOI, handler.totalCollateralIn(), "Short OI bounded");
    }
}

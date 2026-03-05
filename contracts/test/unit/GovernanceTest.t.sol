// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Governance} from "../../src/governance/Governance.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";

contract GovernanceTest is TestSetup {
    Governance public governance;
    FeeManager public feeManager;

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);

        // Deploy FeeManager (target for governance calls)
        FeeManager fmImpl = new FeeManager();
        feeManager = FeeManager(address(new ERC1967Proxy(
            address(fmImpl),
            abi.encodeCall(FeeManager.initialize, (admin, 10, 500, 1, 9000))
        )));

        // Deploy Governance
        Governance govImpl = new Governance();
        governance = Governance(address(new ERC1967Proxy(
            address(govImpl),
            abi.encodeCall(Governance.initialize, (
                admin,
                address(cperp),
                2000,  // 20% quorum
                5100,  // 51% majority
                48 hours
            ))
        )));

        // Transfer FeeManager ownership to Governance
        feeManager.transferOwnership(address(governance));

        // Distribute CPERP to voters
        cperp.transfer(user1, 300_000e18); // 30%
        cperp.transfer(user2, 200_000e18); // 20%
        // admin keeps 500_000 (50%)

        vm.stopPrank();
    }

    function test_propose() public {
        bytes memory callData = abi.encodeCall(FeeManager.setOpenCloseFeeBps, (20)); // change to 0.2%

        vm.prank(user1);
        uint256 proposalId = governance.propose(address(feeManager), callData);
        assertEq(proposalId, 1);
    }

    function test_propose_rejectsNoVotingPower() public {
        vm.prank(user3); // has 0 CPERP
        vm.expectRevert("Governance: no voting power");
        governance.propose(address(feeManager), "");
    }

    function test_voteAndExecute() public {
        bytes memory callData = abi.encodeCall(FeeManager.setOpenCloseFeeBps, (20));

        vm.prank(user1);
        uint256 proposalId = governance.propose(address(feeManager), callData);

        // user1 (30%) votes for
        vm.prank(user1);
        governance.vote(proposalId, true);

        // admin (50%) votes for => 80% for, quorum met (80% > 20%), majority met (100% > 51%)
        vm.prank(admin);
        governance.vote(proposalId, true);

        // Warp past voting period
        vm.warp(block.timestamp + 48 hours + 1);

        // Execute
        governance.execute(proposalId);

        // Verify the change took effect
        assertEq(feeManager.openCloseFeeBps(), 20);
    }

    function test_execute_rejectsQuorumNotMet() public {
        bytes memory callData = abi.encodeCall(FeeManager.setOpenCloseFeeBps, (20));

        vm.prank(user1);
        uint256 proposalId = governance.propose(address(feeManager), callData);

        // Only user2 (20%) votes — exactly at quorum boundary
        vm.prank(user2);
        governance.vote(proposalId, true);

        vm.warp(block.timestamp + 48 hours + 1);

        // 20% votes, 20% quorum — should pass quorum (>=)
        governance.execute(proposalId);
        assertEq(feeManager.openCloseFeeBps(), 20);
    }

    function test_execute_rejectsMajorityNotMet() public {
        bytes memory callData = abi.encodeCall(FeeManager.setOpenCloseFeeBps, (20));

        vm.prank(user1);
        uint256 proposalId = governance.propose(address(feeManager), callData);

        // user1 (30%) votes for
        vm.prank(user1);
        governance.vote(proposalId, true);

        // admin (50%) votes against
        vm.prank(admin);
        governance.vote(proposalId, false);

        vm.warp(block.timestamp + 48 hours + 1);

        // 30/80 = 37.5% for — below 51% majority
        vm.expectRevert("Governance: majority not met");
        governance.execute(proposalId);
    }

    function test_vote_rejectsDoubleVote() public {
        bytes memory callData = abi.encodeCall(FeeManager.setOpenCloseFeeBps, (20));

        vm.prank(user1);
        uint256 proposalId = governance.propose(address(feeManager), callData);

        vm.prank(user1);
        governance.vote(proposalId, true);

        vm.prank(user1);
        vm.expectRevert("Governance: already voted");
        governance.vote(proposalId, true);
    }

    function test_vote_rejectsAfterDeadline() public {
        bytes memory callData = abi.encodeCall(FeeManager.setOpenCloseFeeBps, (20));

        vm.prank(user1);
        uint256 proposalId = governance.propose(address(feeManager), callData);

        vm.warp(block.timestamp + 48 hours + 1);

        vm.prank(user1);
        vm.expectRevert("Governance: voting ended");
        governance.vote(proposalId, true);
    }
}

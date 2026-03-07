// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "../helpers/TestSetup.sol";

contract TokensTest is TestSetup {
    function test_mockUSDC_decimals() public view {
        assertEq(usdc.decimals(), 18);
    }

    function test_mockUSDC_mint() public view {
        assertEq(usdc.balanceOf(user1), 1_000_000e18);
    }

    function test_mockUSDC_onlyOwnerMint() public {
        vm.prank(user1);
        vm.expectRevert();
        usdc.mint(user1, 1e18);
    }

    function test_pmlp_initialize() public view {
        assertEq(pmlp.name(), "pErp-man LP");
        assertEq(pmlp.symbol(), "PMLP");
        assertEq(pmlp.owner(), admin);
    }

    function test_pmlp_mintBurn() public {
        vm.startPrank(admin);
        pmlp.mint(user1, 100e18);
        assertEq(pmlp.balanceOf(user1), 100e18);
        pmlp.burn(user1, 50e18);
        assertEq(pmlp.balanceOf(user1), 50e18);
        vm.stopPrank();
    }

    function test_pmlp_onlyOwnerMint() public {
        vm.prank(user1);
        vm.expectRevert();
        pmlp.mint(user1, 1e18);
    }

    function test_prpman_totalSupply() public view {
        assertEq(prpman.totalSupply(), 1_000_000e18);
        assertEq(prpman.balanceOf(admin), 1_000_000e18);
    }

    function test_prpman_transfer() public {
        vm.prank(admin);
        prpman.transfer(user1, 100e18);
        assertEq(prpman.balanceOf(user1), 100e18);
        assertEq(prpman.balanceOf(admin), 999_900e18);
    }
}

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

    function test_clp_initialize() public view {
        assertEq(clp.name(), "pErp-man LP");
        assertEq(clp.symbol(), "CLP");
        assertEq(clp.owner(), admin);
    }

    function test_clp_mintBurn() public {
        vm.startPrank(admin);
        clp.mint(user1, 100e18);
        assertEq(clp.balanceOf(user1), 100e18);
        clp.burn(user1, 50e18);
        assertEq(clp.balanceOf(user1), 50e18);
        vm.stopPrank();
    }

    function test_clp_onlyOwnerMint() public {
        vm.prank(user1);
        vm.expectRevert();
        clp.mint(user1, 1e18);
    }

    function test_cperp_totalSupply() public view {
        assertEq(cperp.totalSupply(), 1_000_000e18);
        assertEq(cperp.balanceOf(admin), 1_000_000e18);
    }

    function test_cperp_transfer() public {
        vm.prank(admin);
        cperp.transfer(user1, 100e18);
        assertEq(cperp.balanceOf(user1), 100e18);
        assertEq(cperp.balanceOf(admin), 999_900e18);
    }
}

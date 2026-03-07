// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title CPERP
/// @notice Governance token for pErp-man DAO. Fixed supply, minted to deployer.
contract CPERP is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 1_000_000e18; // 1M tokens

    constructor(address admin) ERC20("pErp-man Governance", "CPERP") {
        _mint(admin, INITIAL_SUPPLY);
    }
}

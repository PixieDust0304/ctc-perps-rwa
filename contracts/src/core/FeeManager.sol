// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {FixedPointMath} from "../libraries/FixedPointMath.sol";
import {FeeCalculator} from "../libraries/FeeCalculator.sol";

/// @title FeeManager
/// @notice Central fee configuration and split logic
contract FeeManager is OwnableUpgradeable, UUPSUpgradeable {
    uint256 public openCloseFeeBps;         // e.g., 10 = 0.1%
    uint256 public maxBaseFeePerHourBps;    // e.g., 500 = 5%
    uint256 public maxFundingRatePerIntervalBps; // e.g., 1 = 0.01%
    uint256 public lpShareBps;              // e.g., 9000 = 90%
    uint256 public feeInterval;             // 15 seconds

    event FeeConfigUpdated(string param, uint256 value);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint256 openCloseFeeBps_,
        uint256 maxBaseFeePerHourBps_,
        uint256 maxFundingRatePerIntervalBps_,
        uint256 lpShareBps_
    ) external initializer {
        __Ownable_init(owner_);

        openCloseFeeBps = openCloseFeeBps_;
        maxBaseFeePerHourBps = maxBaseFeePerHourBps_;
        maxFundingRatePerIntervalBps = maxFundingRatePerIntervalBps_;
        lpShareBps = lpShareBps_;
        feeInterval = 15;
    }

    /// @notice Calculate open/close fee for a given notional value
    function calculateOpenCloseFee(uint256 notionalValue) external view returns (uint256) {
        return FeeCalculator.openCloseFee(notionalValue, openCloseFeeBps);
    }

    /// @notice Split a fee between LP and protocol
    function splitFee(uint256 totalFee) external view returns (uint256 lpFee, uint256 protocolFee) {
        return FeeCalculator.splitFee(totalFee, lpShareBps);
    }

    // Admin setters
    function setOpenCloseFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 1000, "FeeManager: max 10%");
        openCloseFeeBps = bps;
        emit FeeConfigUpdated("openCloseFeeBps", bps);
    }

    function setMaxBaseFeePerHourBps(uint256 bps) external onlyOwner {
        require(bps <= 1000, "FeeManager: max 10%");
        maxBaseFeePerHourBps = bps;
        emit FeeConfigUpdated("maxBaseFeePerHourBps", bps);
    }

    function setMaxFundingRatePerIntervalBps(uint256 bps) external onlyOwner {
        maxFundingRatePerIntervalBps = bps;
        emit FeeConfigUpdated("maxFundingRatePerIntervalBps", bps);
    }

    function setLpShareBps(uint256 bps) external onlyOwner {
        require(bps <= FixedPointMath.BPS, "FeeManager: max 100%");
        lpShareBps = bps;
        emit FeeConfigUpdated("lpShareBps", bps);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

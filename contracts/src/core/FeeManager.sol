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
    uint256 public maxBaseFeePerHourBps;    // e.g., 5 = 0.05%
    uint256 public maxFundingRatePerHourBps; // e.g., 5 = 0.05%/hr
    uint256 public lpShareBps;              // e.g., 9000 = 90%
    uint256 public feeInterval;             // 15 seconds
    uint256 public p2pOpenCloseFeeBps;      // separate P2P fee rate (e.g., 10 = 0.1%)

    event FeeConfigUpdated(string param, uint256 value);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint256 openCloseFeeBps_,
        uint256 maxBaseFeePerHourBps_,
        uint256 maxFundingRatePerHourBps_,
        uint256 lpShareBps_,
        uint256 p2pOpenCloseFeeBps_
    ) external initializer {
        __Ownable_init(owner_);

        openCloseFeeBps = openCloseFeeBps_;
        maxBaseFeePerHourBps = maxBaseFeePerHourBps_;
        maxFundingRatePerHourBps = maxFundingRatePerHourBps_;
        lpShareBps = lpShareBps_;
        feeInterval = 15;
        p2pOpenCloseFeeBps = p2pOpenCloseFeeBps_;
    }

    /// @notice Calculate open/close fee for a given notional value
    function calculateOpenCloseFee(uint256 notionalValue) external view returns (uint256) {
        return FeeCalculator.openCloseFee(notionalValue, openCloseFeeBps);
    }

    /// @notice Split a fee between LP and protocol
    function splitFee(uint256 totalFee) external view returns (uint256 lpFee, uint256 protocolFee) {
        return FeeCalculator.splitFee(totalFee, lpShareBps);
    }

    /// @notice Calculate open/close fee for P2P positions
    function calculateP2POpenCloseFee(uint256 notionalValue) external view returns (uint256) {
        return FeeCalculator.openCloseFee(notionalValue, p2pOpenCloseFeeBps);
    }

    // Admin setters
    function setP2POpenCloseFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 1000, "FeeManager: max 10%");
        p2pOpenCloseFeeBps = bps;
        emit FeeConfigUpdated("p2pOpenCloseFeeBps", bps);
    }

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
        require(bps <= 1000, "FeeManager: max 10%");
        maxFundingRatePerHourBps = bps;
        emit FeeConfigUpdated("maxFundingRatePerHourBps", bps);
    }

    function setLpShareBps(uint256 bps) external onlyOwner {
        require(bps <= FixedPointMath.BPS, "FeeManager: max 100%");
        lpShareBps = bps;
        emit FeeConfigUpdated("lpShareBps", bps);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

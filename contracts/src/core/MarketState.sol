// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IOracle} from "../interfaces/IOracle.sol";

/// @title MarketState
/// @notice Per-feed market state machine: OPEN <-> CLOSED. Driven by oracle fresh flag.
contract MarketState is OwnableUpgradeable, UUPSUpgradeable {
    enum State {
        OPEN,
        CLOSED
    }

    IOracle public oracle;

    mapping(uint16 => State) public feedState;
    mapping(uint16 => uint256) public lastStateChangeTimestamp;
    mapping(uint16 => bool) public feedRegistered;

    event MarketStateChanged(uint16 indexed feedId, State oldState, State newState, uint256 timestamp);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address oracle_) external initializer {
        __Ownable_init(owner_);
        oracle = IOracle(oracle_);
    }

    /// @notice Register a feed for state tracking
    function registerFeed(uint16 feedId) external onlyOwner {
        feedRegistered[feedId] = true;
        feedState[feedId] = State.CLOSED; // Start closed until oracle confirms open
    }

    /// @notice Update market state based on oracle fresh flag. Called by keeper.
    function updateState(uint16 feedId) external {
        require(feedRegistered[feedId], "MarketState: unregistered feed");

        IOracle.PriceData memory data = oracle.getPrice(feedId);
        State current = feedState[feedId];
        State newState = data.fresh ? State.OPEN : State.CLOSED;

        if (current != newState) {
            feedState[feedId] = newState;
            lastStateChangeTimestamp[feedId] = block.timestamp;
            emit MarketStateChanged(feedId, current, newState, block.timestamp);
        }
    }

    /// @notice Check if a feed's market is currently open
    function isMarketOpen(uint16 feedId) external view returns (bool) {
        return feedState[feedId] == State.OPEN;
    }

    /// @notice Admin: set oracle address
    function setOracle(address oracle_) external onlyOwner {
        oracle = IOracle(oracle_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

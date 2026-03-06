// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITrading {
    struct Position {
        address owner;
        uint16 feedId;
        bool isLong;
        uint256 collateral;     // 18 decimals
        uint256 sizeUsd;        // notional value, 18 decimals
        uint256 entryPrice;     // 18 decimals
        uint256 openTimestamp;
        uint256 cumulativeBaseFeeSnapshot;
        int256 cumulativeFundingSnapshot;
    }

    event PositionOpened(bytes32 indexed positionId, address indexed owner, uint16 feedId, bool isLong, uint256 collateral, uint256 sizeUsd, uint256 entryPrice);
    event PositionClosed(bytes32 indexed positionId, address indexed owner, int256 realizedPnl);
    event PositionLiquidated(bytes32 indexed positionId, address indexed owner, address liquidator);
    event CollateralAdded(bytes32 indexed positionId, address indexed owner, uint256 amount, uint256 newCollateral);

    function openPosition(uint16 feedId, bool isLong, uint256 collateral, uint256 leverage) external;
    function closePosition(bytes32 positionId) external;
    function liquidate(bytes32 positionId) external;
    function addCollateral(bytes32 positionId, uint256 amount) external;
    function getPosition(bytes32 positionId) external view returns (Position memory);
}

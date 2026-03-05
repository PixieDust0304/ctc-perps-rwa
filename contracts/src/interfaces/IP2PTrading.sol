// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IP2PTrading {
    struct P2PPosition {
        address owner;
        uint16 feedId;
        bool isLong;
        uint256 collateral;
        uint256 sizeUsd;
        uint256 entryPrice;       // VAMM price at open
        uint256 openTimestamp;
        bool isSettled;
    }

    event P2PPositionOpened(bytes32 indexed positionId, address indexed owner, uint16 feedId, bool isLong, uint256 collateral, uint256 sizeUsd, uint256 entryVammPrice);
    event P2PPositionClosed(bytes32 indexed positionId, address indexed owner, int256 realizedPnl);
    event P2PBatchSettled(uint16 indexed feedId, uint256 settledCount, uint256 settlementPrice);

    function openP2PPosition(uint16 feedId, bool isLong, uint256 collateral, uint256 leverage) external;
    function closeP2PPosition(bytes32 positionId) external;
    function settleP2PBatch(bytes32[] calldata positionIds, uint256 settlementPrice) external;
}

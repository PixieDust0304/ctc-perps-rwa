// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVAMM {
    struct VirtualPool {
        uint256 virtualBase;
        uint256 virtualQuote;
        uint256 k;
        uint256 depthMultiplier;
        bool active;
    }

    event VAMMInitialized(uint16 indexed feedId, uint256 baseReserve, uint256 quoteReserve, uint256 k);
    event VAMMDeactivated(uint16 indexed feedId);
    event VAMMSwap(uint16 indexed feedId, bool isLong, uint256 sizeUsd, uint256 avgExecutionPrice);

    function initializeVAMM(uint16 feedId, uint256 spotPrice) external;
    function deactivateVAMM(uint16 feedId) external;
    function getVAMMPrice(uint16 feedId) external view returns (uint256);
    function swap(uint16 feedId, bool isLong, uint256 sizeUsd) external returns (uint256 executionPrice);
    function reverseSwap(uint16 feedId, bool isLong, uint256 sizeUsd) external returns (uint256 executionPrice);
}

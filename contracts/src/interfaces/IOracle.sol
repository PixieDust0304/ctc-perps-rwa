// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOracle {
    struct PriceData {
        uint256 price;    // 18-decimal fixed-point
        uint256 timestamp;
        bool fresh;       // true = market open, false = market closed
    }

    event PriceUpdated(uint16 indexed feedId, uint256 price, uint256 timestamp, bool fresh);
    event TrustedSignerUpdated(address indexed oldSigner, address indexed newSigner);

    function getPrice(uint16 feedId) external view returns (PriceData memory);
    function getPriceIfFresh(uint16 feedId) external view returns (PriceData memory);
    function updatePrices(
        uint16[] calldata feedIds,
        uint256[] calldata prices,
        uint256[] calldata timestamps,
        bool[] calldata freshFlags,
        bytes calldata signature
    ) external;
    function setTrustedSigner(address signer) external;
    function setStalenessThreshold(uint256 threshold) external;
}

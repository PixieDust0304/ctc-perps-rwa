// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICustody {
    event BalanceUpdated(uint256 available, uint256 reserved);
    event OIUpdated(uint256 longOI, uint256 shortOI);

    function feedId() external view returns (uint16);
    function availableBalance() external view returns (uint256);
    function reservedBalance() external view returns (uint256);
    function longOpenInterest() external view returns (uint256);
    function shortOpenInterest() external view returns (uint256);
    function increasePosition(bool isLong, uint256 sizeUsd, uint256 collateral) external;
    function decreasePosition(bool isLong, uint256 sizeUsd, uint256 collateral) external;
    function addLiquidity(uint256 amount) external;
    function removeLiquidity(uint256 amount) external returns (uint256);
    function payTrader(address trader, uint256 amount) external;
    function increaseCollateral(uint256 amount) external;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPool {
    event Deposited(address indexed user, uint256 usdcAmount, uint256 clpMinted);
    event Withdrawn(address indexed user, uint256 clpBurned, uint256 usdcReturned);

    function deposit(uint256 usdcAmount) external;
    function withdraw(uint256 clpAmount) external;
    function totalPoolUSDC() external view returns (uint256);
    function addCustody(address custody, uint256 allocationBps) external;
    function transferToCustody(address custody, uint256 amount) external;
    function receiveFromCustody(address custody, uint256 amount) external;
}

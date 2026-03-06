// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICustody} from "../interfaces/ICustody.sol";
import {FixedPointMath} from "../libraries/FixedPointMath.sol";
import {FeeCalculator} from "../libraries/FeeCalculator.sol";

/// @title Custody
/// @notice Per-commodity custody holding USDC for traders. Deployed once per market.
contract Custody is ICustody, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using FixedPointMath for uint256;

    uint16 public feedId;
    IERC20 public usdc;
    address public pool;
    address public trading;
    address public p2pTrading;
    address public feeManager;

    uint256 public availableBalance;
    uint256 public reservedBalance;

    uint256 public longOpenInterest;
    uint256 public shortOpenInterest;

    // Cumulative fee accumulators (18 decimals) — GMX-style
    uint256 public cumulativeLongBaseFeePerUnit;
    uint256 public cumulativeShortBaseFeePerUnit;
    int256 public cumulativeFundingPerUnit; // positive = longs pay, negative = shorts pay

    uint256 public lastAccrualTimestamp;
    uint256 public constant FEE_INTERVAL = 15; // seconds

    // Fee config
    uint256 public maxBaseFeePerHourBps;
    uint256 public maxFundingRatePerIntervalBps;

    modifier onlyPool() {
        require(msg.sender == pool, "Custody: not pool");
        _;
    }

    modifier onlyTrading() {
        require(msg.sender == trading || msg.sender == p2pTrading, "Custody: not trading");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint16 feedId_,
        address usdc_,
        address pool_,
        uint256 maxBaseFeePerHourBps_,
        uint256 maxFundingRatePerIntervalBps_
    ) external initializer {
        __Ownable_init(owner_);

        feedId = feedId_;
        usdc = IERC20(usdc_);
        pool = pool_;
        maxBaseFeePerHourBps = maxBaseFeePerHourBps_;
        maxFundingRatePerIntervalBps = maxFundingRatePerIntervalBps_;
        lastAccrualTimestamp = block.timestamp;
    }

    /// @notice Accrue base fees and funding rates. Called before any state change.
    function accrueFees() public {
        uint256 elapsed = block.timestamp - lastAccrualTimestamp;
        uint256 intervals = elapsed / FEE_INTERVAL;
        if (intervals == 0) return;

        lastAccrualTimestamp += intervals * FEE_INTERVAL;

        uint256 totalOI = longOpenInterest + shortOpenInterest;
        if (totalOI == 0) return;

        // Base fee accumulators
        uint256 longRate = FeeCalculator.baseFeeRatePerInterval(longOpenInterest, totalOI, maxBaseFeePerHourBps);
        uint256 shortRate = FeeCalculator.baseFeeRatePerInterval(shortOpenInterest, totalOI, maxBaseFeePerHourBps);

        cumulativeLongBaseFeePerUnit += longRate * intervals;
        cumulativeShortBaseFeePerUnit += shortRate * intervals;

        // Funding rate accumulator
        int256 fundingRate = FeeCalculator.fundingRatePerInterval(
            longOpenInterest,
            shortOpenInterest,
            maxFundingRatePerIntervalBps
        );
        cumulativeFundingPerUnit += fundingRate * int256(intervals);
    }

    /// @notice Pool adds liquidity to this custody
    function addLiquidity(uint256 amount) external onlyPool {
        availableBalance += amount;
        emit BalanceUpdated(availableBalance, reservedBalance);
    }

    /// @notice Pool removes liquidity from this custody and transfers USDC back
    function removeLiquidity(uint256 amount) external onlyPool returns (uint256) {
        require(amount <= availableBalance, "Custody: insufficient available");
        availableBalance -= amount;
        usdc.safeTransfer(pool, amount);
        emit BalanceUpdated(availableBalance, reservedBalance);
        return amount;
    }

    /// @notice Called by Trading when opening a position
    function increasePosition(bool isLong, uint256 sizeUsd, uint256 collateral) external onlyTrading {
        accrueFees();

        // Collateral USDC arrived in custody — add to available
        availableBalance += collateral;
        // Reserve the full position size (max potential payout), not just collateral.
        // This ensures availableBalance - reservedBalance reflects what LPs can withdraw
        // and what the pool can actually use to pay other winners.
        reservedBalance += sizeUsd;
        require(availableBalance >= reservedBalance, "Custody: insufficient liquidity");

        if (isLong) {
            longOpenInterest += sizeUsd;
        } else {
            shortOpenInterest += sizeUsd;
        }

        emit OIUpdated(longOpenInterest, shortOpenInterest);
        emit BalanceUpdated(availableBalance, reservedBalance);
    }

    /// @notice Called by Trading when closing/liquidating a position
    function decreasePosition(bool isLong, uint256 sizeUsd, uint256 /* collateral */) external onlyTrading {
        accrueFees();

        // Release the full position size reservation
        reservedBalance = reservedBalance > sizeUsd ? reservedBalance - sizeUsd : 0;

        if (isLong) {
            longOpenInterest -= sizeUsd;
        } else {
            shortOpenInterest -= sizeUsd;
        }

        emit OIUpdated(longOpenInterest, shortOpenInterest);
        emit BalanceUpdated(availableBalance, reservedBalance);
    }

    /// @notice Pay out a winning trader from available balance
    function payTrader(address trader, uint256 amount) external onlyTrading nonReentrant {
        require(amount <= availableBalance, "Custody: insufficient for payout");
        availableBalance -= amount;
        usdc.safeTransfer(trader, amount);
        emit BalanceUpdated(availableBalance, reservedBalance);
    }

    /// @notice Receive fees from trading (base fees go to pool)
    function receiveFees(uint256 amount) external onlyTrading {
        availableBalance += amount;
        emit BalanceUpdated(availableBalance, reservedBalance);
    }

    // Admin setters
    function setTrading(address trading_) external onlyOwner {
        trading = trading_;
    }

    function setP2PTrading(address p2pTrading_) external onlyOwner {
        p2pTrading = p2pTrading_;
    }

    function setFeeManager(address feeManager_) external onlyOwner {
        feeManager = feeManager_;
    }

    function setMaxBaseFeePerHourBps(uint256 bps) external onlyOwner {
        maxBaseFeePerHourBps = bps;
    }

    function setMaxFundingRatePerIntervalBps(uint256 bps) external onlyOwner {
        maxFundingRatePerIntervalBps = bps;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

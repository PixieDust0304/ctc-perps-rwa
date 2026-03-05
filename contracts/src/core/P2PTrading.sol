// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IP2PTrading} from "../interfaces/IP2PTrading.sol";
import {VAMM} from "./VAMM.sol";
import {Pool} from "./Pool.sol";
import {MarketState} from "./MarketState.sol";
import {FeeManager} from "./FeeManager.sol";
import {FixedPointMath} from "../libraries/FixedPointMath.sol";

/// @title P2PTrading
/// @notice Off-hours P2P trading engine using VAMM pricing
contract P2PTrading is IP2PTrading, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using FixedPointMath for uint256;

    IERC20 public usdc;
    VAMM public vamm;
    Pool public pool;
    MarketState public marketState;
    FeeManager public feeManager;

    // P2P escrow balance per feed (separate from main pool)
    mapping(uint16 => uint256) public p2pEscrowBalance;
    mapping(uint16 => uint256) public p2pLongOI;
    mapping(uint16 => uint256) public p2pShortOI;

    // Position storage
    mapping(bytes32 => P2PPosition) public positions;
    uint256 public positionCounter;

    // Config
    uint256 public maxLeverage;
    uint256 public minPositionUsd;
    uint256 public minPositionOpenTime;

    // Track all position IDs per feed for settlement
    mapping(uint16 => bytes32[]) public feedPositionIds;

    address public settlementKeeper;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address usdc_,
        address vamm_,
        address pool_,
        address marketState_,
        address feeManager_,
        uint256 maxLeverage_,
        uint256 minPositionUsd_,
        uint256 minPositionOpenTime_
    ) external initializer {
        __Ownable_init(owner_);
        __Pausable_init();

        usdc = IERC20(usdc_);
        vamm = VAMM(vamm_);
        pool = Pool(pool_);
        marketState = MarketState(marketState_);
        feeManager = FeeManager(feeManager_);
        maxLeverage = maxLeverage_;
        minPositionUsd = minPositionUsd_;
        minPositionOpenTime = minPositionOpenTime_;
    }

    /// @notice Open a P2P position during off-hours
    function openP2PPosition(
        uint16 feedId,
        bool isLong,
        uint256 collateral,
        uint256 leverage
    ) external nonReentrant whenNotPaused {
        require(!marketState.isMarketOpen(feedId), "P2P: market is open");
        require(leverage >= 1e18 && leverage <= maxLeverage, "P2P: invalid leverage");

        uint256 sizeUsd = collateral.mulFp(leverage);
        require(sizeUsd >= minPositionUsd, "P2P: below min size");

        // Calculate and deduct open fee (goes to main pool)
        uint256 openFee = feeManager.calculateOpenCloseFee(sizeUsd);
        require(collateral > openFee, "P2P: fee exceeds collateral");
        uint256 collateralAfterFee = collateral - openFee;

        // Transfer collateral to this contract (P2P escrow)
        usdc.safeTransferFrom(msg.sender, address(this), collateral);

        // Move VAMM price
        uint256 vammPrice = vamm.swap(feedId, isLong, sizeUsd);

        // Record position
        positionCounter++;
        bytes32 positionId = keccak256(abi.encodePacked(msg.sender, positionCounter, "p2p"));

        positions[positionId] = P2PPosition({
            owner: msg.sender,
            feedId: feedId,
            isLong: isLong,
            collateral: collateralAfterFee,
            sizeUsd: sizeUsd,
            entryPrice: vammPrice,
            openTimestamp: block.timestamp,
            isSettled: false
        });

        feedPositionIds[feedId].push(positionId);
        p2pEscrowBalance[feedId] += collateralAfterFee;

        if (isLong) {
            p2pLongOI[feedId] += sizeUsd;
        } else {
            p2pShortOI[feedId] += sizeUsd;
        }

        // Open fee to main pool
        usdc.safeTransfer(address(pool), openFee);
        pool.receiveFees(openFee);

        emit P2PPositionOpened(positionId, msg.sender, feedId, isLong, collateralAfterFee, sizeUsd, vammPrice);
    }

    /// @notice Close a P2P position during off-hours (at VAMM price)
    function closeP2PPosition(bytes32 positionId) external nonReentrant whenNotPaused {
        P2PPosition storage pos = positions[positionId];
        require(pos.owner == msg.sender, "P2P: not owner");
        require(pos.collateral > 0 && !pos.isSettled, "P2P: invalid position");
        require(!marketState.isMarketOpen(pos.feedId), "P2P: market is open");
        require(
            block.timestamp >= pos.openTimestamp + minPositionOpenTime,
            "P2P: min open time"
        );

        // Reverse the VAMM impact
        uint256 currentPrice = vamm.reverseSwap(pos.feedId, pos.isLong, pos.sizeUsd);

        // Calculate PnL at VAMM price
        (uint256 pnl, bool isProfit) = _calculateP2PPnL(pos, currentPrice);

        // Close fee
        uint256 closeFee = feeManager.calculateOpenCloseFee(pos.sizeUsd);

        // Calculate payout
        uint256 payout;
        uint256 cappedPnl;
        if (isProfit) {
            // Cap profit to OTHER traders' collateral only (exclude own collateral from escrow)
            uint256 otherEscrow = p2pEscrowBalance[pos.feedId] > pos.collateral
                ? p2pEscrowBalance[pos.feedId] - pos.collateral
                : 0;
            cappedPnl = FixedPointMath.min(pnl, otherEscrow);
            payout = pos.collateral + cappedPnl;
        } else {
            payout = pnl >= pos.collateral ? 0 : pos.collateral - pnl;
        }

        // Deduct close fee
        if (closeFee >= payout) {
            closeFee = payout;
            payout = 0;
        } else {
            payout -= closeFee;
        }

        // Cap payout at actual USDC in contract (prevents revert if prior profitable closes drained USDC)
        uint256 available = usdc.balanceOf(address(this));
        if (payout + closeFee > available) {
            if (available > closeFee) {
                payout = available - closeFee;
            } else {
                closeFee = available;
                payout = 0;
            }
        }

        // Update escrow: remove this position's collateral, PLUS any profit taken from others' USDC
        {
            uint256 escrowDecrease = pos.collateral;
            if (isProfit && cappedPnl > 0) {
                escrowDecrease += cappedPnl;
            }
            p2pEscrowBalance[pos.feedId] = p2pEscrowBalance[pos.feedId] > escrowDecrease
                ? p2pEscrowBalance[pos.feedId] - escrowDecrease
                : 0;
        }
        if (pos.isLong) {
            p2pLongOI[pos.feedId] -= pos.sizeUsd;
        } else {
            p2pShortOI[pos.feedId] -= pos.sizeUsd;
        }

        // Pay trader
        if (payout > 0) {
            usdc.safeTransfer(pos.owner, payout);
        }

        // Close fee to pool
        if (closeFee > 0) {
            usdc.safeTransfer(address(pool), closeFee);
            pool.receiveFees(closeFee);
        }

        int256 realizedPnl = isProfit ? int256(pnl) : -int256(pnl);
        pos.isSettled = true;

        emit P2PPositionClosed(positionId, pos.owner, realizedPnl);
    }

    /// @notice Batch settle all P2P positions at market open (called by keeper)
    function settleP2PBatch(
        bytes32[] calldata positionIds,
        uint256 settlementPrice
    ) external nonReentrant whenNotPaused {
        require(msg.sender == settlementKeeper || msg.sender == owner(), "P2P: not keeper");

        uint16 feedId;
        uint256 settledCount;

        for (uint256 i = 0; i < positionIds.length; i++) {
            P2PPosition storage pos = positions[positionIds[i]];
            if (pos.collateral == 0 || pos.isSettled) continue;

            if (i == 0) feedId = pos.feedId;
            require(pos.feedId == feedId, "P2P: mixed feeds");

            (uint256 pnl, bool isProfit) = _calculateP2PPnLAtPrice(pos, settlementPrice);

            uint256 payout;
            uint256 cappedPnl;
            if (isProfit) {
                // Cap profit to other traders' collateral (exclude own)
                uint256 otherEscrow = p2pEscrowBalance[feedId] > pos.collateral
                    ? p2pEscrowBalance[feedId] - pos.collateral
                    : 0;
                cappedPnl = FixedPointMath.min(pnl, otherEscrow);
                payout = pos.collateral + cappedPnl;
            } else {
                payout = pnl >= pos.collateral ? 0 : pos.collateral - pnl;
            }

            // Update escrow: remove position's collateral + any profit taken from others
            {
                uint256 escrowDecrease = pos.collateral;
                if (isProfit && cappedPnl > 0) {
                    escrowDecrease += cappedPnl;
                }
                p2pEscrowBalance[feedId] = p2pEscrowBalance[feedId] > escrowDecrease
                    ? p2pEscrowBalance[feedId] - escrowDecrease
                    : 0;
            }

            if (pos.isLong) {
                p2pLongOI[feedId] -= FixedPointMath.min(pos.sizeUsd, p2pLongOI[feedId]);
            } else {
                p2pShortOI[feedId] -= FixedPointMath.min(pos.sizeUsd, p2pShortOI[feedId]);
            }

            if (payout > 0 && usdc.balanceOf(address(this)) >= payout) {
                usdc.safeTransfer(pos.owner, payout);
            }

            pos.isSettled = true;
            settledCount++;
        }

        if (settledCount > 0) {
            emit P2PBatchSettled(feedId, settledCount, settlementPrice);
        }
    }

    function _calculateP2PPnL(
        P2PPosition storage pos,
        uint256 currentPrice
    ) internal view returns (uint256 pnl, bool isProfit) {
        return _calculateP2PPnLAtPrice(pos, currentPrice);
    }

    function _calculateP2PPnLAtPrice(
        P2PPosition storage pos,
        uint256 price
    ) internal view returns (uint256 pnl, bool isProfit) {
        uint256 leverage = pos.sizeUsd.divFp(pos.collateral);
        if (pos.isLong) {
            if (price >= pos.entryPrice) {
                isProfit = true;
                pnl = FixedPointMath.mulDiv(pos.sizeUsd, price - pos.entryPrice, pos.entryPrice);
            } else {
                isProfit = false;
                pnl = FixedPointMath.mulDiv(pos.sizeUsd, pos.entryPrice - price, pos.entryPrice);
            }
        } else {
            if (pos.entryPrice >= price) {
                isProfit = true;
                pnl = FixedPointMath.mulDiv(pos.sizeUsd, pos.entryPrice - price, pos.entryPrice);
            } else {
                isProfit = false;
                pnl = FixedPointMath.mulDiv(pos.sizeUsd, price - pos.entryPrice, pos.entryPrice);
            }
        }
        // Cap profit at collateral * leverage
        if (isProfit) {
            uint256 maxPnl = pos.collateral.mulFp(leverage);
            pnl = FixedPointMath.min(pnl, maxPnl);
        }
    }

    function getFeedPositionCount(uint16 feedId) external view returns (uint256) {
        return feedPositionIds[feedId].length;
    }

    // Admin
    function setSettlementKeeper(address keeper) external onlyOwner {
        settlementKeeper = keeper;
    }

    function setMaxLeverage(uint256 lev) external onlyOwner {
        maxLeverage = lev;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

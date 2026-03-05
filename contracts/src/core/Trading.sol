// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITrading} from "../interfaces/ITrading.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {Custody} from "./Custody.sol";
import {Pool} from "./Pool.sol";
import {FeeManager} from "./FeeManager.sol";
import {MarketState} from "./MarketState.sol";
import {FixedPointMath} from "../libraries/FixedPointMath.sol";
import {PositionUtils} from "../libraries/PositionUtils.sol";
import {FeeCalculator} from "../libraries/FeeCalculator.sol";

/// @title Trading
/// @notice Market-hours trading engine: open, close, liquidate positions
contract Trading is ITrading, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using FixedPointMath for uint256;

    IERC20 public usdc;
    IOracle public oracle;
    Pool public pool;
    FeeManager public feeManager;
    MarketState public marketState;

    // feedId => custody address
    mapping(uint16 => address) public feedCustody;

    // Position storage
    mapping(bytes32 => Position) public positions;
    uint256 public positionCounter;

    // Config
    uint256 public maxLeverage;              // e.g., 100e18
    uint256 public maintenanceMarginBps;     // e.g., 3000 = 30%
    uint256 public minPositionUsd;           // e.g., 10e18 = $10
    uint256 public minPositionOpenTime;      // e.g., 120 seconds

    event FeesCollected(bytes32 indexed positionId, uint256 baseFee, uint256 openCloseFee);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address usdc_,
        address oracle_,
        address pool_,
        address feeManager_,
        address marketState_,
        uint256 maxLeverage_,
        uint256 maintenanceMarginBps_,
        uint256 minPositionUsd_,
        uint256 minPositionOpenTime_
    ) external initializer {
        __Ownable_init(owner_);
        __Pausable_init();

        usdc = IERC20(usdc_);
        oracle = IOracle(oracle_);
        pool = Pool(pool_);
        feeManager = FeeManager(feeManager_);
        marketState = MarketState(marketState_);
        maxLeverage = maxLeverage_;
        maintenanceMarginBps = maintenanceMarginBps_;
        minPositionUsd = minPositionUsd_;
        minPositionOpenTime = minPositionOpenTime_;
    }

    /// @notice Open a market-hours position
    function openPosition(
        uint16 feedId,
        bool isLong,
        uint256 collateral,
        uint256 leverage
    ) external nonReentrant whenNotPaused {
        require(marketState.isMarketOpen(feedId), "Trading: market closed");
        require(leverage >= 1e18 && leverage <= maxLeverage, "Trading: invalid leverage");

        uint256 sizeUsd = collateral.mulFp(leverage);
        require(sizeUsd >= minPositionUsd, "Trading: below min size");

        address custodyAddr = feedCustody[feedId];
        require(custodyAddr != address(0), "Trading: no custody");
        Custody custody = Custody(custodyAddr);

        // Get fresh oracle price
        IOracle.PriceData memory priceData = oracle.getPriceIfFresh(feedId);

        // Calculate and deduct open fee
        uint256 openFee = feeManager.calculateOpenCloseFee(sizeUsd);
        require(collateral > openFee, "Trading: fee exceeds collateral");
        uint256 collateralAfterFee = collateral - openFee;

        // Transfer collateral from trader to custody
        usdc.safeTransferFrom(msg.sender, custodyAddr, collateral);

        // Record position
        positionCounter++;
        bytes32 positionId = keccak256(abi.encodePacked(msg.sender, positionCounter));

        positions[positionId] = Position({
            owner: msg.sender,
            feedId: feedId,
            isLong: isLong,
            collateral: collateralAfterFee,
            sizeUsd: sizeUsd,
            entryPrice: priceData.price,
            openTimestamp: block.timestamp,
            cumulativeBaseFeeSnapshot: isLong
                ? custody.cumulativeLongBaseFeePerUnit()
                : custody.cumulativeShortBaseFeePerUnit(),
            cumulativeFundingSnapshot: uint256(
                custody.cumulativeFundingPerUnit() >= 0
                    ? custody.cumulativeFundingPerUnit()
                    : -custody.cumulativeFundingPerUnit()
            )
        });

        // Update custody OI
        custody.increasePosition(isLong, sizeUsd, collateralAfterFee);

        // Track fee USDC in custody's available balance (fee was transferred with collateral)
        custody.receiveFees(openFee);

        // Fees to pool accounting
        pool.receiveFees(openFee);

        emit PositionOpened(positionId, msg.sender, feedId, isLong, collateralAfterFee, sizeUsd, priceData.price);
        emit FeesCollected(positionId, 0, openFee);
    }

    /// @notice Close a position (owner only)
    function closePosition(bytes32 positionId) external nonReentrant whenNotPaused {
        Position memory pos = positions[positionId];
        require(pos.owner == msg.sender, "Trading: not owner");
        require(pos.collateral > 0, "Trading: already closed");
        require(
            block.timestamp >= pos.openTimestamp + minPositionOpenTime,
            "Trading: min open time"
        );

        _closePosition(positionId, pos, false);
    }

    /// @notice Liquidate an undercollateralized position (anyone can call)
    function liquidate(bytes32 positionId) external nonReentrant whenNotPaused {
        Position memory pos = positions[positionId];
        require(pos.collateral > 0, "Trading: already closed");

        address custodyAddr = feedCustody[pos.feedId];
        Custody custody = Custody(custodyAddr);
        custody.accrueFees();

        IOracle.PriceData memory priceData = oracle.getPriceIfFresh(pos.feedId);

        // Calculate PnL
        (uint256 pnl, bool isProfit) = PositionUtils.calculatePnL(
            pos.collateral,
            pos.sizeUsd.divFp(pos.collateral), // leverage
            pos.entryPrice,
            priceData.price,
            pos.isLong
        );

        // Calculate accumulated fees
        uint256 accumulatedBaseFee = _calculateAccumulatedBaseFee(pos, custody);

        // Check liquidation condition
        uint256 effectiveCol = PositionUtils.effectiveCollateral(
            pos.collateral,
            accumulatedBaseFee,
            0, // funding simplified for v1
            pnl,
            isProfit
        );

        require(
            PositionUtils.isLiquidatable(pos.collateral, effectiveCol, maintenanceMarginBps),
            "Trading: not liquidatable"
        );

        _closePosition(positionId, pos, true);

        emit PositionLiquidated(positionId, pos.owner, msg.sender);
    }

    /// @notice Get a position's data
    function getPosition(bytes32 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    // Internal close logic
    function _closePosition(bytes32 positionId, Position memory pos, bool isLiquidation) internal {
        address custodyAddr = feedCustody[pos.feedId];
        Custody custody = Custody(custodyAddr);
        custody.accrueFees();

        IOracle.PriceData memory priceData = oracle.getPriceIfFresh(pos.feedId);

        // Calculate PnL
        uint256 leverage = pos.sizeUsd.divFp(pos.collateral);
        (uint256 pnl, bool isProfit) = PositionUtils.calculatePnL(
            pos.collateral,
            leverage,
            pos.entryPrice,
            priceData.price,
            pos.isLong
        );

        // Calculate accumulated base fee
        uint256 accumulatedBaseFee = _calculateAccumulatedBaseFee(pos, custody);

        // Close fee
        uint256 closeFee = isLiquidation ? 0 : feeManager.calculateOpenCloseFee(pos.sizeUsd);

        // Calculate net payout
        uint256 payout;
        if (isProfit) {
            uint256 cappedPnl = PositionUtils.capPayout(
                pnl,
                pos.collateral,
                leverage,
                custody.availableBalance()
            );
            payout = pos.collateral + cappedPnl;
        } else {
            payout = pnl >= pos.collateral ? 0 : pos.collateral - pnl;
        }

        // Capture payout before fee deduction for PnL reporting
        uint256 payoutBeforeFees = payout;

        // Deduct fees from payout
        uint256 totalFees = accumulatedBaseFee + closeFee;
        if (totalFees >= payout) {
            totalFees = payout;
            payout = 0;
        } else {
            payout -= totalFees;
        }

        // Update custody: decrease OI, release collateral
        custody.decreasePosition(pos.isLong, pos.sizeUsd, pos.collateral);

        // Pay trader
        if (payout > 0) {
            custody.payTrader(pos.owner, payout);
        }

        // Fees to pool accounting
        if (totalFees > 0) {
            pool.receiveFees(totalFees);
        }

        // Report PnL impact to pool: positive = pool gains (trader lost), negative = pool loses (trader won)
        // PnL impact = collateral that stayed in custody minus fees (fees already reported above)
        int256 pnlImpact = int256(pos.collateral) - int256(payoutBeforeFees);
        if (pnlImpact != 0) {
            pool.absorbPnL(pnlImpact);
        }

        // Clear position
        int256 realizedPnl = isProfit ? int256(pnl) : -int256(pnl);
        delete positions[positionId];

        emit PositionClosed(positionId, pos.owner, realizedPnl);
    }

    function _calculateAccumulatedBaseFee(
        Position memory pos,
        Custody custody
    ) internal view returns (uint256) {
        uint256 currentCumulativeFee = pos.isLong
            ? custody.cumulativeLongBaseFeePerUnit()
            : custody.cumulativeShortBaseFeePerUnit();

        uint256 feePerUnit = currentCumulativeFee - pos.cumulativeBaseFeeSnapshot;
        return pos.sizeUsd.mulFp(feePerUnit);
    }

    // Admin functions
    function setFeedCustody(uint16 feedId, address custody) external onlyOwner {
        feedCustody[feedId] = custody;
    }

    function setMaxLeverage(uint256 lev) external onlyOwner {
        maxLeverage = lev;
    }

    function setMaintenanceMarginBps(uint256 bps) external onlyOwner {
        maintenanceMarginBps = bps;
    }

    function setMinPositionOpenTime(uint256 time) external onlyOwner {
        minPositionOpenTime = time;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

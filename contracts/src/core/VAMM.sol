// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IVAMM} from "../interfaces/IVAMM.sol";
import {FixedPointMath} from "../libraries/FixedPointMath.sol";

/// @title VAMM
/// @notice Virtual AMM (x*y=k) for off-hours price discovery per commodity
contract VAMM is IVAMM, OwnableUpgradeable, UUPSUpgradeable {
    using FixedPointMath for uint256;

    mapping(uint16 => VirtualPool) public vamms;

    // Depth multiplier per feed (e.g., 1e6 for gold: $13T -> ~$13M virtual)
    mapping(uint16 => uint256) public depthMultiplier;

    address public marketState;
    address public p2pTrading;
    address public keeper;

    event MarketStateUpdated(address indexed oldMarketState, address indexed newMarketState);
    event P2PTradingUpdated(address indexed oldP2PTrading, address indexed newP2PTrading);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);

    modifier onlyAuthorized() {
        require(
            msg.sender == owner() || msg.sender == marketState || msg.sender == p2pTrading || msg.sender == keeper,
            "VAMM: unauthorized"
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
    }

    /// @notice Initialize VAMM for a feed at the given spot price
    function initializeVAMM(uint16 feedId, uint256 spotPrice) external onlyAuthorized {
        require(!vamms[feedId].active, "VAMM: already active");
        require(spotPrice > 0, "VAMM: zero price");

        uint256 multiplier = depthMultiplier[feedId];
        require(multiplier > 0, "VAMM: no multiplier set");

        // virtualQuote = depth (in USD, 18 decimals)
        // virtualBase = depth / spotPrice (in asset units)
        // k = virtualBase * virtualQuote
        uint256 virtualQuote = multiplier; // depth in USD
        uint256 virtualBase = virtualQuote.divFp(spotPrice);
        uint256 k = virtualBase.mulFp(virtualQuote);

        vamms[feedId] = VirtualPool({
            virtualBase: virtualBase,
            virtualQuote: virtualQuote,
            k: k,
            depthMultiplier: multiplier,
            active: true
        });

        emit VAMMInitialized(feedId, virtualBase, virtualQuote, k);
    }

    /// @notice Deactivate VAMM when market opens
    function deactivateVAMM(uint16 feedId) external onlyAuthorized {
        require(vamms[feedId].active, "VAMM: not active");
        vamms[feedId].active = false;
        emit VAMMDeactivated(feedId);
    }

    /// @notice Get current VAMM price: quote / base
    function getVAMMPrice(uint16 feedId) external view returns (uint256) {
        VirtualPool memory v = vamms[feedId];
        require(v.active, "VAMM: not active");
        return v.virtualQuote.divFp(v.virtualBase);
    }

    /// @notice Execute a swap (position open). Returns execution price.
    /// @param isLong true = buy base (price goes up), false = sell base (price goes down)
    /// @param sizeUsd notional size in USD (18 decimals)
    function swap(uint16 feedId, bool isLong, uint256 sizeUsd) external onlyAuthorized returns (uint256 executionPrice) {
        VirtualPool storage v = vamms[feedId];
        require(v.active, "VAMM: not active");

        uint256 baseBefore = v.virtualBase;

        if (isLong) {
            // Trader buys base: adds quote, removes base
            // new_quote = quote + sizeUsd
            // new_base = k / new_quote
            uint256 newQuote = v.virtualQuote + sizeUsd;
            uint256 newBase = v.k.divFp(newQuote);
            v.virtualQuote = newQuote;
            v.virtualBase = newBase;
        } else {
            // Trader sells base: removes quote, adds base
            // new_quote = quote - sizeUsd (quote decreases)
            require(sizeUsd < v.virtualQuote, "VAMM: size too large");
            uint256 newQuote = v.virtualQuote - sizeUsd;
            uint256 newBase = v.k.divFp(newQuote);
            v.virtualQuote = newQuote;
            v.virtualBase = newBase;
        }

        executionPrice = v.virtualQuote.divFp(baseBefore);
        emit VAMMSwap(feedId, isLong, sizeUsd, executionPrice);
    }

    /// @notice Reverse a swap (position close). Returns execution price.
    function reverseSwap(uint16 feedId, bool isLong, uint256 sizeUsd) external onlyAuthorized returns (uint256 executionPrice) {
        VirtualPool storage v = vamms[feedId];
        require(v.active, "VAMM: not active");

        uint256 baseBefore = v.virtualBase;

        // Reverse: opposite of swap
        if (isLong) {
            // Closing long = selling base: removes quote
            require(sizeUsd < v.virtualQuote, "VAMM: size too large");
            uint256 newQuote = v.virtualQuote - sizeUsd;
            uint256 newBase = v.k.divFp(newQuote);
            v.virtualQuote = newQuote;
            v.virtualBase = newBase;
        } else {
            // Closing short = buying base: adds quote
            uint256 newQuote = v.virtualQuote + sizeUsd;
            uint256 newBase = v.k.divFp(newQuote);
            v.virtualQuote = newQuote;
            v.virtualBase = newBase;
        }

        executionPrice = v.virtualQuote.divFp(baseBefore);
        emit VAMMSwap(feedId, !isLong, sizeUsd, executionPrice);
    }

    // Admin
    function setDepthMultiplier(uint16 feedId, uint256 multiplier) external onlyAuthorized {
        depthMultiplier[feedId] = multiplier;
    }

    function setMarketState(address ms) external onlyOwner {
        require(ms != address(0), "VAMM: zero address");
        emit MarketStateUpdated(marketState, ms);
        marketState = ms;
    }

    function setP2PTrading(address p2p) external onlyOwner {
        require(p2p != address(0), "VAMM: zero address");
        emit P2PTradingUpdated(p2pTrading, p2p);
        p2pTrading = p2p;
    }

    function setKeeper(address keeper_) external onlyOwner {
        require(keeper_ != address(0), "VAMM: zero address");
        emit KeeperUpdated(keeper, keeper_);
        keeper = keeper_;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

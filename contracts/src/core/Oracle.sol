// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {PriceUtils} from "../libraries/PriceUtils.sol";

/// @title Oracle
/// @notice Stores prices submitted by a trusted signer. UUPS upgradeable.
contract Oracle is IOracle, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    mapping(uint16 => PriceData) public prices;
    address public trustedSigner;
    uint256 public stalenessThreshold;

    // Supported feed IDs
    mapping(uint16 => bool) public supportedFeeds;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address trustedSigner_,
        uint256 stalenessThreshold_,
        uint16[] calldata feedIds
    ) external initializer {
        __Ownable_init(owner_);
        __Pausable_init();

        require(trustedSigner_ != address(0), "Oracle: zero signer");
        trustedSigner = trustedSigner_;
        stalenessThreshold = stalenessThreshold_;

        for (uint256 i = 0; i < feedIds.length; i++) {
            supportedFeeds[feedIds[i]] = true;
        }
    }

    /// @notice Update prices for multiple feeds in a single tx
    function updatePrices(
        uint16[] calldata feedIds,
        uint256[] calldata rawPrices,
        uint256[] calldata timestamps,
        bool[] calldata freshFlags,
        bytes calldata signature
    ) external whenNotPaused {
        require(
            feedIds.length == rawPrices.length
                && feedIds.length == timestamps.length
                && feedIds.length == freshFlags.length,
            "Oracle: length mismatch"
        );

        _verifySignature(feedIds, rawPrices, timestamps, freshFlags, signature);
        _storePrices(feedIds, rawPrices, timestamps, freshFlags);
    }

    function _verifySignature(
        uint16[] calldata feedIds,
        uint256[] calldata rawPrices,
        uint256[] calldata timestamps,
        bool[] calldata freshFlags,
        bytes calldata signature
    ) internal view {
        bytes32 messageHash = keccak256(
            abi.encode(feedIds, rawPrices, timestamps, freshFlags)
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);
        require(recovered == trustedSigner, "Oracle: invalid signature");
    }

    function _storePrices(
        uint16[] calldata feedIds,
        uint256[] calldata rawPrices,
        uint256[] calldata timestamps,
        bool[] calldata freshFlags
    ) internal {
        for (uint256 i = 0; i < feedIds.length; i++) {
            require(supportedFeeds[feedIds[i]], "Oracle: unsupported feed");
            require(rawPrices[i] > 0, "Oracle: zero price");
            require(timestamps[i] > prices[feedIds[i]].timestamp, "Oracle: stale update");

            uint256 price18 = PriceUtils.toPrice18(rawPrices[i]);
            prices[feedIds[i]] = PriceData({
                price: price18,
                timestamp: timestamps[i],
                fresh: freshFlags[i]
            });

            emit PriceUpdated(feedIds[i], price18, timestamps[i], freshFlags[i]);
        }
    }

    /// @notice Get price for a feed (no staleness check)
    function getPrice(uint16 feedId) external view returns (PriceData memory) {
        require(prices[feedId].price > 0, "Oracle: no price");
        return prices[feedId];
    }

    /// @notice Get price only if fresh (not stale). Used during market hours.
    function getPriceIfFresh(uint16 feedId) external view returns (PriceData memory) {
        PriceData memory data = prices[feedId];
        require(data.price > 0, "Oracle: no price");
        require(data.fresh, "Oracle: market closed");
        require(
            block.timestamp - data.timestamp <= stalenessThreshold,
            "Oracle: stale price"
        );
        return data;
    }

    /// @notice Admin: update trusted signer
    function setTrustedSigner(address signer) external onlyOwner {
        require(signer != address(0), "Oracle: zero signer");
        emit TrustedSignerUpdated(trustedSigner, signer);
        trustedSigner = signer;
    }

    /// @notice Admin: update staleness threshold
    function setStalenessThreshold(uint256 threshold) external onlyOwner {
        stalenessThreshold = threshold;
    }

    /// @notice Admin: add supported feed
    function addSupportedFeed(uint16 feedId) external onlyOwner {
        supportedFeeds[feedId] = true;
    }

    /// @notice Admin: pause/unpause
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

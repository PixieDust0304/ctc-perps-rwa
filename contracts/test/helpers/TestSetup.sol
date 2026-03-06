// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockUSDC} from "../../src/tokens/MockUSDC.sol";
import {CLP} from "../../src/tokens/CLP.sol";
import {CPERP} from "../../src/tokens/CPERP.sol";
import {Oracle} from "../../src/core/Oracle.sol";

abstract contract TestSetup is Test {
    MockUSDC public usdc;
    CLP public clp;
    CPERP public cperp;
    Oracle public oracle;

    address public admin = makeAddr("admin");
    address public user1 = makeAddr("user1");
    address public user2 = makeAddr("user2");
    address public user3 = makeAddr("user3");
    address public liquidator = makeAddr("liquidator");

    uint256 public signerPrivateKey = 0xA11CE;
    address public signer;

    uint16 public constant GOLD_FEED = 2056;
    uint16 public constant SILVER_FEED = 2069;
    uint16 public constant CRUDE_OIL_FEED = 2003;
    uint16 public constant PLATINUM_FEED = 2062;

    uint256 public constant STALENESS_THRESHOLD = 210;

    function setUp() public virtual {
        signer = vm.addr(signerPrivateKey);

        vm.startPrank(admin);

        // Deploy tokens
        usdc = new MockUSDC();
        cperp = new CPERP(admin);

        // Deploy CLP via proxy
        CLP clpImpl = new CLP();
        bytes memory clpInitData = abi.encodeCall(CLP.initialize, (admin));
        ERC1967Proxy clpProxy = new ERC1967Proxy(address(clpImpl), clpInitData);
        clp = CLP(address(clpProxy));

        // Deploy Oracle via proxy
        uint16[] memory feedIds = new uint16[](4);
        feedIds[0] = GOLD_FEED;
        feedIds[1] = SILVER_FEED;
        feedIds[2] = CRUDE_OIL_FEED;
        feedIds[3] = PLATINUM_FEED;

        Oracle oracleImpl = new Oracle();
        bytes memory oracleInitData = abi.encodeCall(
            Oracle.initialize,
            (admin, signer, STALENESS_THRESHOLD, feedIds)
        );
        ERC1967Proxy oracleProxy = new ERC1967Proxy(address(oracleImpl), oracleInitData);
        oracle = Oracle(address(oracleProxy));

        // Mint USDC to test users
        usdc.mint(user1, 1_000_000e18);
        usdc.mint(user2, 1_000_000e18);
        usdc.mint(user3, 1_000_000e18);

        vm.stopPrank();
    }

    /// @dev Helper to sign and submit prices to oracle
    function _updateOraclePrice(
        uint16 feedId,
        uint256 rawPrice,
        uint256 timestamp,
        bool fresh
    ) internal {
        uint16[] memory feedIds = new uint16[](1);
        uint256[] memory prices = new uint256[](1);
        uint256[] memory timestamps = new uint256[](1);
        bool[] memory freshFlags = new bool[](1);

        feedIds[0] = feedId;
        prices[0] = rawPrice;
        timestamps[0] = timestamp;
        freshFlags[0] = fresh;

        bytes32 messageHash = keccak256(
            abi.encode(feedIds, prices, timestamps, freshFlags)
        );
        bytes32 ethSignedHash = MessageHashUtils_toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        oracle.updatePrices(feedIds, prices, timestamps, freshFlags, signature);
    }

    /// @dev Helper to update all 4 feeds at once
    function _updateAllPrices(
        uint256 goldRaw,
        uint256 silverRaw,
        uint256 crudeOilRaw,
        uint256 platinumRaw,
        uint256 timestamp,
        bool fresh
    ) internal {
        uint16[] memory feedIds = new uint16[](4);
        uint256[] memory prices = new uint256[](4);
        uint256[] memory timestamps = new uint256[](4);
        bool[] memory freshFlags = new bool[](4);

        feedIds[0] = GOLD_FEED; prices[0] = goldRaw; timestamps[0] = timestamp; freshFlags[0] = fresh;
        feedIds[1] = SILVER_FEED; prices[1] = silverRaw; timestamps[1] = timestamp; freshFlags[1] = fresh;
        feedIds[2] = CRUDE_OIL_FEED; prices[2] = crudeOilRaw; timestamps[2] = timestamp; freshFlags[2] = fresh;
        feedIds[3] = PLATINUM_FEED; prices[3] = platinumRaw; timestamps[3] = timestamp; freshFlags[3] = fresh;

        bytes32 messageHash = keccak256(
            abi.encode(feedIds, prices, timestamps, freshFlags)
        );
        bytes32 ethSignedHash = MessageHashUtils_toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        oracle.updatePrices(feedIds, prices, timestamps, freshFlags, signature);
    }

    /// @dev Inline toEthSignedMessageHash to avoid import issues
    function MessageHashUtils_toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }
}

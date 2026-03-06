// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPool} from "../interfaces/IPool.sol";
import {CLP} from "../tokens/CLP.sol";
import {Custody} from "./Custody.sol";
import {WaterfallWithdraw} from "../libraries/WaterfallWithdraw.sol";
import {FixedPointMath} from "../libraries/FixedPointMath.sol";

/// @title Pool
/// @notice Single liquidity pool for all commodities. Manages USDC and CLP token.
contract Pool is IPool, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuard, PausableUpgradeable {
    using SafeERC20 for IERC20;
    using FixedPointMath for uint256;

    IERC20 public usdc;
    CLP public clpToken;
    address public protocolFeeReceiver;

    uint256 public totalPoolUSDC;

    address[] public custodies;
    mapping(address => bool) public isCustody;
    mapping(address => uint256) public custodyAllocationBps;

    address public trading;
    address public p2pTrading;

    uint256 public lpShareBps; // e.g., 9000 = 90%

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address usdc_,
        address clpToken_,
        address protocolFeeReceiver_,
        uint256 lpShareBps_
    ) external initializer {
        __Ownable_init(owner_);
        __Pausable_init();

        usdc = IERC20(usdc_);
        clpToken = CLP(clpToken_);
        protocolFeeReceiver = protocolFeeReceiver_;
        lpShareBps = lpShareBps_;
    }

    /// @notice LP deposits USDC, receives CLP tokens
    function deposit(uint256 usdcAmount) external nonReentrant whenNotPaused {
        require(usdcAmount > 0, "Pool: zero amount");

        // Transfer USDC from user
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Calculate CLP to mint
        uint256 clpToMint;
        uint256 clpSupply = clpToken.totalSupply();
        if (clpSupply == 0 || totalPoolUSDC == 0) {
            clpToMint = usdcAmount; // 1:1 for first deposit
        } else {
            clpToMint = (usdcAmount * clpSupply) / totalPoolUSDC;
        }

        totalPoolUSDC += usdcAmount;

        // Distribute to custodies based on allocation
        _distributeToCustomes(usdcAmount);

        // Mint CLP to depositor
        clpToken.mint(msg.sender, clpToMint);

        emit Deposited(msg.sender, usdcAmount, clpToMint);
    }

    /// @notice LP burns CLP tokens, receives USDC back via waterfall withdrawal
    function withdraw(uint256 clpAmount) external nonReentrant whenNotPaused {
        require(clpAmount > 0, "Pool: zero amount");
        require(clpToken.balanceOf(msg.sender) >= clpAmount, "Pool: insufficient CLP");

        uint256 clpSupply = clpToken.totalSupply();
        uint256 usdcToReturn = (clpAmount * totalPoolUSDC) / clpSupply;

        require(usdcToReturn > 0, "Pool: zero return");

        // Calculate waterfall withdrawal amounts from custodies
        uint256[] memory balances = _getCustodyBalances();
        uint256[] memory withdrawAmounts = WaterfallWithdraw.calculate(usdcToReturn, balances);

        // Update accounting before external calls (checks-effects-interactions)
        totalPoolUSDC -= usdcToReturn;

        // Burn CLP
        clpToken.burn(msg.sender, clpAmount);

        // Execute withdrawals from each custody
        for (uint256 i = 0; i < custodies.length; i++) {
            if (withdrawAmounts[i] > 0) {
                Custody(custodies[i]).removeLiquidity(withdrawAmounts[i]);
            }
        }

        // Transfer USDC to user
        usdc.safeTransfer(msg.sender, usdcToReturn);

        emit Withdrawn(msg.sender, clpAmount, usdcToReturn);
    }

    /// @notice Transfer USDC from pool to a custody (called by Trading for collateral)
    function transferToCustody(address custody, uint256 amount) external {
        require(msg.sender == trading, "Pool: not trading");
        require(isCustody[custody], "Pool: not a custody");
        usdc.safeTransfer(custody, amount);
    }

    /// @notice Receive USDC back from custody (on position close / fee collection)
    function receiveFromCustody(address custody, uint256 amount) external {
        require(isCustody[custody], "Pool: not a custody");
        // USDC transfer happens externally, this just updates accounting
        totalPoolUSDC += amount;
    }

    /// @notice Receive fees from trading — split between LP and protocol
    /// For market-hours (Trading): fee USDC is already in custody, this is accounting only
    /// For off-hours (P2PTrading): fee USDC was sent to pool, distribute to custodies
    function receiveFees(uint256 feeAmount) external {
        require(msg.sender == trading || msg.sender == p2pTrading || isCustody[msg.sender], "Pool: unauthorized");
        uint256 lpFee = (feeAmount * lpShareBps) / FixedPointMath.BPS;
        uint256 protocolFee = feeAmount - lpFee;

        totalPoolUSDC += lpFee;
        // Protocol fee stays in pool for now (can be claimed by protocolFeeReceiver)
        if (protocolFee > 0) {
            totalPoolUSDC += protocolFee; // For v1: protocol fee stays in pool
        }

        // P2P fees arrive as actual USDC in pool — forward to custodies so all USDC lives there
        if (msg.sender == p2pTrading && feeAmount > 0) {
            _distributeToCustomes(feeAmount);
        }
    }

    /// @notice Absorb PnL from trader positions — increases pool on trader loss, decreases on trader win
    function absorbPnL(int256 pnlAmount) external {
        require(msg.sender == trading, "Pool: not trading");
        if (pnlAmount >= 0) {
            totalPoolUSDC += uint256(pnlAmount);
        } else {
            uint256 loss = uint256(-pnlAmount);
            totalPoolUSDC = totalPoolUSDC > loss ? totalPoolUSDC - loss : 0;
        }
    }

    // Admin functions
    function addCustody(address custody, uint256 allocationBps) external onlyOwner {
        require(!isCustody[custody], "Pool: already added");
        custodies.push(custody);
        isCustody[custody] = true;
        custodyAllocationBps[custody] = allocationBps;
    }

    function setCustodyAllocation(address custody, uint256 allocationBps) external onlyOwner {
        require(isCustody[custody], "Pool: not a custody");
        custodyAllocationBps[custody] = allocationBps;
    }

    function setTrading(address trading_) external onlyOwner {
        trading = trading_;
    }

    function setP2PTrading(address p2pTrading_) external onlyOwner {
        p2pTrading = p2pTrading_;
    }

    function setLpShareBps(uint256 bps) external onlyOwner {
        require(bps <= FixedPointMath.BPS, "Pool: invalid bps");
        lpShareBps = bps;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function getCustodyCount() external view returns (uint256) {
        return custodies.length;
    }

    // Internal
    function _distributeToCustomes(uint256 amount) internal {
        uint256 totalBps;
        for (uint256 i = 0; i < custodies.length; i++) {
            totalBps += custodyAllocationBps[custodies[i]];
        }
        if (totalBps == 0 || custodies.length == 0) return;

        uint256 distributed;
        for (uint256 i = 0; i < custodies.length; i++) {
            uint256 share;
            if (i == custodies.length - 1) {
                share = amount - distributed; // Remainder to last custody
            } else {
                share = (amount * custodyAllocationBps[custodies[i]]) / totalBps;
            }
            if (share > 0) {
                usdc.safeTransfer(custodies[i], share);
                Custody(custodies[i]).addLiquidity(share);
            }
            distributed += share;
        }
    }

    function _getCustodyBalances() internal view returns (uint256[] memory) {
        uint256[] memory balances = new uint256[](custodies.length);
        for (uint256 i = 0; i < custodies.length; i++) {
            balances[i] = Custody(custodies[i]).availableBalance();
        }
        return balances;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

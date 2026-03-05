// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WaterfallWithdraw
/// @notice Proportional LP withdrawal across custodies with waterfall redistribution
library WaterfallWithdraw {
    /// @notice Calculate how much to withdraw from each custody
    /// @param totalWithdrawAmount Total USDC to withdraw
    /// @param custodyBalances Available balance in each custody
    /// @return withdrawAmounts Amount to withdraw from each custody
    function calculate(
        uint256 totalWithdrawAmount,
        uint256[] memory custodyBalances
    ) internal pure returns (uint256[] memory withdrawAmounts) {
        uint256 numCustodies = custodyBalances.length;
        require(numCustodies > 0, "Waterfall: no custodies");

        withdrawAmounts = new uint256[](numCustodies);
        bool[] memory exhausted = new bool[](numCustodies);
        uint256 remaining = totalWithdrawAmount;
        uint256 activeCustodies = numCustodies;

        while (remaining > 0 && activeCustodies > 0) {
            uint256 perCustody = remaining / activeCustodies;
            if (perCustody == 0) break;

            uint256 shortfall = 0;
            uint256 newExhausted = 0;

            for (uint256 i = 0; i < numCustodies; i++) {
                if (exhausted[i]) continue;

                uint256 available = custodyBalances[i] - withdrawAmounts[i];
                if (available <= perCustody) {
                    // Drain this custody
                    shortfall += perCustody - available;
                    withdrawAmounts[i] = custodyBalances[i];
                    exhausted[i] = true;
                    newExhausted++;
                } else {
                    withdrawAmounts[i] += perCustody;
                }
            }

            remaining = shortfall;
            activeCustodies -= newExhausted;
        }

        require(remaining == 0, "Waterfall: insufficient liquidity");
    }
}

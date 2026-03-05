"use client";

import { useAccount, useReadContract } from "wagmi";
import { formatEther, type Address } from "viem";
import { CONTRACTS, MOCK_USDC_ABI } from "../../lib/contracts";
import { useContractWrite } from "../../hooks/useContractWrite";

export function FaucetButton() {
  const { address, isConnected } = useAccount();
  const { execute, isPending } = useContractWrite();

  const { data: balance } = useReadContract({
    address: CONTRACTS.mockUSDC as Address,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const handleFaucet = () => {
    if (!CONTRACTS.mockUSDC) return;
    execute(
      {
        address: CONTRACTS.mockUSDC as Address,
        abi: MOCK_USDC_ABI,
        functionName: "faucet",
      },
      "Minting 10K USDC"
    );
  };

  const balanceNum = balance ? Number(formatEther(balance as bigint)) : 0;

  return (
    <div className="flex items-center gap-3">
      {isConnected && (
        <span className="text-sm text-gray-400">
          <span className="font-mono text-white">
            {balanceNum.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>{" "}
          USDC
        </span>
      )}
      <button
        onClick={handleFaucet}
        disabled={!isConnected || isPending}
        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {isPending ? "Minting..." : "Mint 10K USDC"}
      </button>
    </div>
  );
}

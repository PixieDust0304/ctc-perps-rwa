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
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
          style={{
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--coal-border)",
          }}
        >
          <span className="font-body font-semibold" style={{ color: "var(--soft-white)" }}>
            {balanceNum.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
          <span style={{ color: "var(--dim-text)" }}>USDC</span>
        </div>
      )}
      <button
        onClick={handleFaucet}
        disabled={!isConnected || isPending}
        className="px-3 py-1.5 text-xs font-pixel font-bold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
        style={{
          background: "linear-gradient(135deg, var(--pixel-yellow), var(--arcade-orange))",
          color: "var(--void-black)",
          boxShadow: "0 2px 8px var(--pixel-yellow-glow)",
        }}
      >
        {isPending ? "Minting..." : "Mint 10K USDC"}
      </button>
    </div>
  );
}

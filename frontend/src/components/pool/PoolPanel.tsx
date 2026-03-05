"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import { CONTRACTS, POOL_ABI, ERC20_ABI } from "../../lib/contracts";

const CLP_ABI = [
  {
    name: "totalSupply",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export function PoolPanel() {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");

  // Pool stats
  const { data: totalPoolUSDC } = useReadContract({
    address: CONTRACTS.pool as Address,
    abi: POOL_ABI,
    functionName: "totalPoolUSDC",
    query: { enabled: !!CONTRACTS.pool, refetchInterval: 5000 },
  });

  // User balances
  const { data: usdcBalance } = useReadContract({
    address: CONTRACTS.mockUSDC as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address && !!CONTRACTS.mockUSDC, refetchInterval: 5000 },
  });

  const { data: clpBalance } = useReadContract({
    address: CONTRACTS.clp as Address,
    abi: CLP_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address && !!CONTRACTS.clp, refetchInterval: 5000 },
  });

  const { data: clpTotalSupply } = useReadContract({
    address: CONTRACTS.clp as Address,
    abi: CLP_ABI,
    functionName: "totalSupply",
    query: { enabled: !!CONTRACTS.clp, refetchInterval: 5000 },
  });

  const poolTvl = totalPoolUSDC ? Number(formatEther(totalPoolUSDC as bigint)) : 0;
  const userUsdc = usdcBalance ? Number(formatEther(usdcBalance as bigint)) : 0;
  const userClp = clpBalance ? Number(formatEther(clpBalance as bigint)) : 0;
  const totalClp = clpTotalSupply ? Number(formatEther(clpTotalSupply as bigint)) : 0;
  const sharePercent = totalClp > 0 ? (userClp / totalClp) * 100 : 0;
  const userPoolValue = totalClp > 0 ? (userClp / totalClp) * poolTvl : 0;

  const handleDeposit = () => {
    if (!address || !CONTRACTS.pool || !depositAmount) return;
    const amount = parseEther(depositAmount);

    // Approve first
    writeContract({
      address: CONTRACTS.mockUSDC as Address,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.pool as Address, amount],
    });

    // Then deposit
    writeContract({
      address: CONTRACTS.pool as Address,
      abi: POOL_ABI,
      functionName: "deposit",
      args: [amount],
    });
  };

  const handleWithdraw = () => {
    if (!address || !CONTRACTS.pool || !withdrawAmount) return;
    const amount = parseEther(withdrawAmount);

    writeContract({
      address: CONTRACTS.pool as Address,
      abi: POOL_ABI,
      functionName: "withdraw",
      args: [amount],
    });
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Pool Stats */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="text-xl font-bold text-white mb-4">Liquidity Pool</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-400">Total Pool TVL</p>
            <p className="text-xl font-mono text-white">
              ${poolTvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-400">CLP Supply</p>
            <p className="text-xl font-mono text-white">
              {totalClp.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Your CLP Balance</p>
            <p className="text-xl font-mono text-white">
              {userClp.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Your Pool Share</p>
            <p className="text-xl font-mono text-white">
              {sharePercent.toFixed(2)}%
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-sm text-gray-400">Your Pool Value</p>
            <p className="text-2xl font-mono text-white">
              ${userPoolValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Deposit / Withdraw */}
      <div className="bg-gray-900 rounded-lg p-6">
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setActiveTab("deposit")}
            className={`py-2 rounded-lg font-medium transition-colors ${
              activeTab === "deposit"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            Deposit
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className={`py-2 rounded-lg font-medium transition-colors ${
              activeTab === "withdraw"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            Withdraw
          </button>
        </div>

        {activeTab === "deposit" ? (
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>Amount (USDC)</span>
                <span>Balance: {userUsdc.toFixed(2)}</span>
              </div>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="10000"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <button
              onClick={handleDeposit}
              disabled={!isConnected || isPending || !depositAmount}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:opacity-50 rounded-lg font-medium text-white transition-colors"
            >
              {!isConnected
                ? "Connect Wallet"
                : isPending
                  ? "Confirming..."
                  : "Deposit USDC"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>Amount (CLP)</span>
                <span>Balance: {userClp.toFixed(2)}</span>
              </div>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="1000"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <button
              onClick={handleWithdraw}
              disabled={!isConnected || isPending || !withdrawAmount}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:opacity-50 rounded-lg font-medium text-white transition-colors"
            >
              {!isConnected
                ? "Connect Wallet"
                : isPending
                  ? "Confirming..."
                  : "Withdraw USDC"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

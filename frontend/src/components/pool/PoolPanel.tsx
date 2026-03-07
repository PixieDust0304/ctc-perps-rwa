"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
} from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import { CONTRACTS, POOL_ABI, ERC20_ABI } from "../../lib/contracts";
import { useContractWrite } from "../../hooks/useContractWrite";

const PMLP_ABI = [
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
  const { execute, isPending } = useContractWrite();

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

  const { data: pmlpBalance } = useReadContract({
    address: CONTRACTS.pmlp as Address,
    abi: PMLP_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address && !!CONTRACTS.pmlp, refetchInterval: 5000 },
  });

  const { data: pmlpTotalSupply } = useReadContract({
    address: CONTRACTS.pmlp as Address,
    abi: PMLP_ABI,
    functionName: "totalSupply",
    query: { enabled: !!CONTRACTS.pmlp, refetchInterval: 5000 },
  });

  const poolTvl = totalPoolUSDC ? Number(formatEther(totalPoolUSDC as bigint)) : 0;
  const userUsdc = usdcBalance ? Number(formatEther(usdcBalance as bigint)) : 0;
  const userPmlp = pmlpBalance ? Number(formatEther(pmlpBalance as bigint)) : 0;
  const totalPmlp = pmlpTotalSupply ? Number(formatEther(pmlpTotalSupply as bigint)) : 0;
  const sharePercent = totalPmlp > 0 ? (userPmlp / totalPmlp) * 100 : 0;
  const userPoolValue = totalPmlp > 0 ? (userPmlp / totalPmlp) * poolTvl : 0;

  const handleDeposit = async () => {
    if (!address || !CONTRACTS.pool || !depositAmount) return;
    const amount = parseEther(depositAmount);

    const approved = await execute(
      {
        address: CONTRACTS.mockUSDC as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.pool as Address, amount],
      },
      "Approving USDC"
    );

    if (!approved) return;

    await execute(
      {
        address: CONTRACTS.pool as Address,
        abi: POOL_ABI,
        functionName: "deposit",
        args: [amount],
      },
      `Depositing ${depositAmount} USDC`
    );
  };

  const handleWithdraw = async () => {
    if (!address || !CONTRACTS.pool || !withdrawAmount) return;
    const amount = parseEther(withdrawAmount);

    await execute(
      {
        address: CONTRACTS.pool as Address,
        abi: POOL_ABI,
        functionName: "withdraw",
        args: [amount],
      },
      `Withdrawing ${withdrawAmount} PMLP`
    );
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* Pool Stats */}
      <div
        className="rounded-xl p-6"
        style={{
          background: "linear-gradient(160deg, var(--coal-surface) 0%, var(--void-black) 100%)",
          border: "1px solid var(--coal-border)",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
        }}
      >
        <h2 className="text-lg font-pixel font-bold uppercase tracking-wider mb-5" style={{ color: "var(--pixel-yellow)" }}>
          Liquidity Pool
        </h2>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <p className="text-xs font-pixel uppercase tracking-wider mb-1" style={{ color: "var(--muted-text)" }}>Total Pool TVL</p>
            <p className="text-xl font-mono font-bold" style={{ color: "var(--soft-white)" }}>
              ${poolTvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-xs font-pixel uppercase tracking-wider mb-1" style={{ color: "var(--muted-text)" }}>PMLP Supply</p>
            <p className="text-xl font-mono font-bold" style={{ color: "var(--soft-white)" }}>
              {totalPmlp.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-xs font-pixel uppercase tracking-wider mb-1" style={{ color: "var(--muted-text)" }}>Your PMLP Balance</p>
            <p className="text-xl font-mono font-bold" style={{ color: "#A855F7" }}>
              {userPmlp.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p className="text-xs font-pixel uppercase tracking-wider mb-1" style={{ color: "var(--muted-text)" }}>Your Pool Share</p>
            <p className="text-xl font-mono font-bold" style={{ color: "#A855F7" }}>
              {sharePercent.toFixed(2)}%
            </p>
          </div>
          <div className="col-span-2 pt-2" style={{ borderTop: "1px solid var(--coal-border)" }}>
            <p className="text-xs font-pixel uppercase tracking-wider mb-1" style={{ color: "var(--muted-text)" }}>Your Pool Value</p>
            <p className="text-2xl font-mono font-bold" style={{ color: "var(--pixel-yellow)", textShadow: "0 0 12px var(--pixel-yellow-glow)" }}>
              ${userPoolValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Deposit / Withdraw */}
      <div
        className="rounded-xl p-6"
        style={{
          background: "linear-gradient(160deg, var(--coal-surface) 0%, var(--void-black) 100%)",
          border: "1px solid var(--coal-border)",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
        }}
      >
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            onClick={() => setActiveTab("deposit")}
            className="py-2.5 rounded-xl font-pixel font-bold text-sm transition-all"
            style={activeTab === "deposit" ? {
              background: "linear-gradient(135deg, var(--pixel-yellow), var(--arcade-orange))",
              color: "#000",
              boxShadow: "0 4px 12px var(--pixel-yellow-glow), inset 0 1px 0 rgba(255,255,255,0.3)",
            } : {
              background: "var(--coal-lighter)",
              border: "1px solid var(--coal-border)",
              color: "var(--muted-text)",
            }}
          >
            Deposit
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className="py-2.5 rounded-xl font-pixel font-bold text-sm transition-all"
            style={activeTab === "withdraw" ? {
              background: "linear-gradient(135deg, #A855F7, #7C3AED)",
              color: "#fff",
              boxShadow: "0 4px 12px rgba(168, 85, 247, 0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
            } : {
              background: "var(--coal-lighter)",
              border: "1px solid var(--coal-border)",
              color: "var(--muted-text)",
            }}
          >
            Withdraw
          </button>
        </div>

        {activeTab === "deposit" ? (
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs font-pixel uppercase tracking-wider mb-1.5" style={{ color: "var(--dim-text)" }}>
                <span>Amount (USDC)</span>
                <span style={{ color: "var(--muted-text)" }}>Balance: {userUsdc.toFixed(2)}</span>
              </div>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="10000"
                className="w-full rounded-xl px-3 py-2.5 text-white font-body text-sm outline-none transition-all"
                style={{
                  background: "var(--void-black)",
                  border: "1px solid var(--coal-border)",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                }}
              />
            </div>
            <button
              onClick={handleDeposit}
              disabled={!isConnected || isPending || !depositAmount}
              className="w-full py-3 rounded-xl font-pixel font-bold text-sm text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={{
                background: (!isConnected || isPending || !depositAmount)
                  ? "#3d3200"
                  : "linear-gradient(135deg, var(--pixel-yellow), var(--arcade-orange))",
                boxShadow: (!isConnected || isPending || !depositAmount)
                  ? "none"
                  : "0 4px 16px var(--pixel-yellow-glow), inset 0 1px 0 rgba(255,255,255,0.2)",
              }}
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
              <div className="flex justify-between text-xs font-pixel uppercase tracking-wider mb-1.5" style={{ color: "var(--dim-text)" }}>
                <span>Amount (PMLP)</span>
                <span style={{ color: "var(--muted-text)" }}>Balance: {userPmlp.toFixed(2)}</span>
              </div>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="1000"
                className="w-full rounded-xl px-3 py-2.5 text-white font-body text-sm outline-none transition-all"
                style={{
                  background: "var(--void-black)",
                  border: "1px solid var(--coal-border)",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                }}
              />
            </div>
            <button
              onClick={handleWithdraw}
              disabled={!isConnected || isPending || !withdrawAmount}
              className="w-full py-3 rounded-xl font-pixel font-bold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={{
                background: (!isConnected || isPending || !withdrawAmount)
                  ? "#2d1a4e"
                  : "linear-gradient(135deg, #A855F7, #7C3AED)",
                boxShadow: (!isConnected || isPending || !withdrawAmount)
                  ? "none"
                  : "0 4px 16px rgba(168, 85, 247, 0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
              }}
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

"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { parseEther, type Address } from "viem";
import { CONTRACTS, TRADING_ABI, P2P_TRADING_ABI, ERC20_ABI } from "../../lib/contracts";
import { useContractWrite } from "../../hooks/useContractWrite";

interface OrderPanelProps {
  feedId: number;
  currentPrice: number;
  isMarketOpen: boolean;
}

export function OrderPanel({
  feedId,
  currentPrice,
  isMarketOpen,
}: OrderPanelProps) {
  const { address, isConnected } = useAccount();
  const { execute, isPending } = useContractWrite();

  const [isLong, setIsLong] = useState(true);
  const [collateral, setCollateral] = useState("");
  const [leverage, setLeverage] = useState("10");

  const collateralNum = parseFloat(collateral) || 0;
  const leverageNum = parseFloat(leverage) || 1;
  const notional = collateralNum * leverageNum;
  const openFee = notional * 0.001; // 0.1%
  const feePercent = leverageNum * 0.1; // fee as % of collateral

  const liqPrice = currentPrice > 0 && leverageNum > 0
    ? isLong
      ? currentPrice * (1 - 0.7 / leverageNum)
      : currentPrice * (1 + 0.7 / leverageNum)
    : 0;

  const handleApproveAndOpen = async () => {
    if (!address || collateralNum <= 0) return;

    const useP2P = !isMarketOpen;
    const targetContract = useP2P ? CONTRACTS.p2pTrading : CONTRACTS.trading;
    if (!targetContract) return;

    const collateralWei = parseEther(collateral);
    const leverageWei = parseEther(leverage);

    // Step 1: Approve
    const approved = await execute(
      {
        address: CONTRACTS.mockUSDC as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [targetContract as Address, collateralWei],
      },
      "Approving USDC"
    );

    if (!approved) return;

    // Step 2: Open position (P2P or direct)
    if (useP2P) {
      await execute(
        {
          address: CONTRACTS.p2pTrading as Address,
          abi: P2P_TRADING_ABI,
          functionName: "openP2PPosition",
          args: [feedId, isLong, collateralWei, leverageWei],
        },
        `Opening P2P ${isLong ? "Long" : "Short"} $${notional.toFixed(0)}`
      );
    } else {
      await execute(
        {
          address: CONTRACTS.trading as Address,
          abi: TRADING_ABI,
          functionName: "openPosition",
          args: [feedId, isLong, collateralWei, leverageWei],
        },
        `Opening ${isLong ? "Long" : "Short"} $${notional.toFixed(0)}`
      );
    }
  };

  return (
    <div className="flex flex-col flex-1 space-y-4">
      <h3 className="text-lg font-semibold text-white">
        {isMarketOpen ? "Open Position" : "Open P2P Position"}
      </h3>

      {/* Long/Short Toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setIsLong(true)}
          className={`py-2 rounded-lg font-medium transition-colors ${
            isLong
              ? "bg-green-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          Long
        </button>
        <button
          onClick={() => setIsLong(false)}
          className={`py-2 rounded-lg font-medium transition-colors ${
            !isLong
              ? "bg-red-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          Short
        </button>
      </div>

      {/* Collateral Input */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">
          Collateral (USDC)
        </label>
        <input
          type="number"
          value={collateral}
          onChange={(e) => setCollateral(e.target.value)}
          placeholder="1000"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
        />
      </div>

      {/* Leverage Slider */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">
          Leverage: {leverage}x
        </label>
        <input
          type="range"
          min="1"
          max="100"
          value={leverage}
          onChange={(e) => setLeverage(e.target.value)}
          className="w-full"
        />
        <div className="relative text-xs text-gray-500 h-4">
          <span className="absolute left-0">1x</span>
          <span className="absolute left-1/4 -translate-x-1/2">25x</span>
          <span className="absolute left-1/2 -translate-x-1/2">50x</span>
          <span className="absolute left-3/4 -translate-x-1/2">75x</span>
          <span className="absolute right-0">100x</span>
        </div>
      </div>

      {/* Order Summary */}
      <div className="bg-gray-800 rounded-lg p-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Position Size</span>
          <span className="text-white">${notional.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Entry Price</span>
          <span className="text-white">${currentPrice.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Open Fee (0.1%)</span>
          <span className="text-white">${openFee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Liq. Price</span>
          <span className="text-orange-400 font-mono">
            {liqPrice > 0 ? `$${liqPrice.toFixed(2)}` : "\u2014"}
          </span>
        </div>
        {feePercent >= 5 && (
          <div className="text-amber-400 text-xs mt-1">
            Warning: Open+close fees = {(feePercent * 2).toFixed(1)}% of
            collateral at {leverage}x leverage
          </div>
        )}
      </div>

      <div className="flex-1" />
      {/* Submit Button */}
      <button
        onClick={handleApproveAndOpen}
        disabled={!isConnected || isPending || collateralNum <= 0}
        className={`w-full py-3 rounded-lg font-medium text-white transition-colors ${
          isLong
            ? "bg-green-600 hover:bg-green-700 disabled:bg-green-900"
            : "bg-red-600 hover:bg-red-700 disabled:bg-red-900"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {!isConnected
          ? "Connect Wallet"
          : isPending
            ? "Confirming..."
            : `${isMarketOpen ? "" : "P2P "}${isLong ? "Long" : "Short"} ${notional.toFixed(0)} USD`}
      </button>
    </div>
  );
}

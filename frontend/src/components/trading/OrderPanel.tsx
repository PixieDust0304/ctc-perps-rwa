"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { parseEther, type Address } from "viem";
import { CONTRACTS, TRADING_ABI, P2P_TRADING_ABI, ERC20_ABI, CUSTODY_ABI, CUSTODY_ADDRESSES } from "../../lib/contracts";
import { IconDollar } from "../AppSidebar";
import { useContractWrite } from "../../hooks/useContractWrite";
import { useReadContracts } from "wagmi";
import { formatEther } from "viem";

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

  const useP2P = !isMarketOpen;
  const collateralNum = parseFloat(collateral) || 0;
  const leverageNum = useP2P ? 1 : parseFloat(leverage) || 1;
  const notional = collateralNum * leverageNum;
  const openFee = notional * 0.001; // 0.1%
  const collateralAfterFee = collateralNum - openFee;
  const sizeUsd = collateralAfterFee > 0 ? collateralAfterFee * leverageNum : 0;
  const feePercent = leverageNum * 0.1; // fee as % of collateral

  // 10% maintenance margin (only for leveraged trading)
  const liqPrice = !useP2P && currentPrice > 0 && leverageNum > 0
    ? isLong
      ? currentPrice * (1 - 0.9 / leverageNum)
      : currentPrice * (1 + 0.9 / leverageNum)
    : 0;

  // Fetch custody available liquidity (only for market-hours trading)
  const custodyAddr = CUSTODY_ADDRESSES[feedId as keyof typeof CUSTODY_ADDRESSES];
  const { data: custodyData } = useReadContracts({
    contracts: custodyAddr && !useP2P ? [
      {
        address: custodyAddr as Address,
        abi: CUSTODY_ABI,
        functionName: "lpLiquidity" as const,
      },
      {
        address: custodyAddr as Address,
        abi: CUSTODY_ABI,
        functionName: "reservedBalance" as const,
      },
    ] : [],
    query: { refetchInterval: 5000 },
  });

  const lpLiq = custodyData?.[0]?.result as bigint | undefined;
  const reservedBal = custodyData?.[1]?.result as bigint | undefined;
  const availableLiq = !useP2P && lpLiq !== undefined && reservedBal !== undefined
    ? Number(formatEther(lpLiq > reservedBal ? lpLiq - reservedBal : 0n))
    : null;

  const exceedsLiquidity = availableLiq !== null && sizeUsd > availableLiq && sizeUsd > 0;

  const handleApproveAndOpen = async () => {
    if (!address || collateralNum <= 0) return;

    const targetContract = useP2P ? CONTRACTS.p2pTrading : CONTRACTS.trading;
    if (!targetContract) return;

    const collateralWei = parseEther(collateral);

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

    // Step 2: Open position
    if (useP2P) {
      await execute(
        {
          address: CONTRACTS.p2pTrading as Address,
          abi: P2P_TRADING_ABI,
          functionName: "openP2PPosition",
          args: [feedId, isLong, collateralWei],
        },
        `Opening P2P Spot ${isLong ? "Long" : "Short"} $${collateralNum.toFixed(0)}`
      );
    } else {
      const leverageWei = parseEther(leverage);
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
      <h3 className="text-sm font-pixel font-bold uppercase tracking-wider" style={{ color: "var(--muted-text)" }}>
        {isMarketOpen ? "Open Position" : "P2P Spot Position"}
      </h3>

      {/* Long/Short Toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setIsLong(true)}
          className={`py-2.5 rounded-xl font-pixel font-bold text-sm transition-all ${isLong ? "text-black" : "text-gray-400 hover:text-gray-200"}`}
          style={isLong ? {
            background: "linear-gradient(135deg, #00E676, #00C853)",
            boxShadow: "0 4px 12px rgba(0, 230, 118, 0.3), inset 0 1px 0 rgba(255,255,255,0.3)",
          } : {
            background: "var(--coal-lighter)",
            border: "1px solid var(--coal-border)",
          }}
        >
          ▲ Long
        </button>
        <button
          onClick={() => setIsLong(false)}
          className={`py-2.5 rounded-xl font-pixel font-bold text-sm transition-all ${!isLong ? "text-white" : "text-gray-400 hover:text-gray-200"}`}
          style={!isLong ? {
            background: "linear-gradient(135deg, var(--trade-red), #D50000)",
            boxShadow: "0 4px 12px var(--trade-red-glow), inset 0 1px 0 rgba(255,255,255,0.1)",
          } : {
            background: "var(--coal-lighter)",
            border: "1px solid var(--coal-border)",
          }}
        >
          ▼ Short
        </button>
      </div>

      {/* Collateral Input */}
      <div>
        <label className="block text-xs font-pixel mb-1 font-semibold uppercase tracking-wider" style={{ color: "var(--dim-text)" }}>
          Collateral (USDC)
        </label>
        <input
          type="number"
          value={collateral}
          onChange={(e) => setCollateral(e.target.value)}
          placeholder="1000"
          className="w-full rounded-xl px-3 py-2.5 text-white font-body text-sm outline-none transition-all"
          style={{
            background: "var(--void-black)",
            border: "1px solid var(--coal-border)",
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
          }}
          onFocus={(e) => { e.target.style.borderColor = isLong ? "rgba(0, 230, 118, 0.3)" : "rgba(255, 23, 68, 0.3)"; e.target.style.boxShadow = `inset 0 2px 4px rgba(0,0,0,0.3), 0 0 0 2px ${isLong ? "rgba(0, 230, 118, 0.08)" : "rgba(255, 23, 68, 0.08)"}`; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--coal-border)"; e.target.style.boxShadow = "inset 0 2px 4px rgba(0,0,0,0.3)"; }}
        />
      </div>

      {/* Leverage Slider — hidden in P2P mode */}
      {useP2P ? (
        <div>
          <label className="block text-xs font-pixel mb-1 font-semibold uppercase tracking-wider" style={{ color: "var(--dim-text)" }}>
            Mode: <span className="text-purple-400">Spot (1:1)</span>
          </label>
          <div className="text-xs font-pixel px-2 py-1.5 rounded-lg" style={{ color: "var(--dim-text)", background: "rgba(168, 85, 247, 0.08)", border: "1px solid rgba(168, 85, 247, 0.15)" }}>
            No leverage — position size equals collateral
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-pixel mb-1 font-semibold uppercase tracking-wider" style={{ color: "var(--dim-text)" }}>
            Leverage: <span style={{ color: isLong ? "#00E676" : "var(--trade-red)" }}>{leverage}x</span>
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
      )}

      {/* Order Summary */}
      <div
        className="rounded-xl p-3 space-y-1.5 text-sm"
        style={{
          background: "var(--void-black)",
          border: "1px solid var(--coal-border)",
          boxShadow: "inset 0 2px 4px rgba(0,0,0,0.2)",
        }}
      >
        <div className="flex justify-between">
          <span className="text-xs font-pixel" style={{ color: "var(--dim-text)" }}>Position Size</span>
          <span className="font-body text-xs" style={{ color: "var(--soft-white)" }}>${sizeUsd.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs font-pixel" style={{ color: "var(--dim-text)" }}>Entry Price</span>
          <span className="font-body text-xs" style={{ color: "var(--soft-white)" }}>${currentPrice.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs font-pixel" style={{ color: "var(--dim-text)" }}>Open Fee (0.1%)</span>
          <span className="font-body text-xs" style={{ color: "var(--soft-white)" }}>${openFee.toFixed(2)}</span>
        </div>
        {!useP2P && (
          <div className="flex justify-between">
            <span className="text-xs font-pixel" style={{ color: "var(--dim-text)" }}>Liq. Price</span>
            <span className="font-body text-xs" style={{ color: "var(--arcade-orange)" }}>
              {liqPrice > 0 ? `$${liqPrice.toFixed(2)}` : "\u2014"}
            </span>
          </div>
        )}
        {availableLiq !== null && (
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <span style={{ color: "var(--profit-green)" }}>
                <IconDollar size={12} />
              </span>
              <span className="text-xs font-pixel" style={{ color: "var(--dim-text)" }}>Avail. Liquidity</span>
            </div>
            <span className={`font-body text-xs font-semibold`} style={{ color: exceedsLiquidity ? "var(--trade-red)" : "var(--profit-green)", textShadow: exceedsLiquidity ? "none" : "0 0 6px rgba(0, 230, 118, 0.2)" }}>
              ${availableLiq.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        )}
        {!useP2P && feePercent >= 5 && (
          <div className="text-[10px] mt-1 px-2 py-1 rounded-lg font-pixel" style={{ color: "var(--arcade-orange)", background: "rgba(255, 138, 0, 0.08)" }}>
            ⚠ Open+close fees = {(feePercent * 2).toFixed(1)}% of collateral at {leverage}x
          </div>
        )}
      </div>

      {/* Liquidity error */}
      {exceedsLiquidity && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
          Position size (${sizeUsd.toFixed(0)}) exceeds available liquidity (${availableLiq?.toFixed(0)}). Reduce collateral or leverage.
        </div>
      )}

      <div className="flex-1" />
      {/* Submit Button */}
      <button
        onClick={handleApproveAndOpen}
        disabled={!isConnected || isPending || collateralNum <= 0 || exceedsLiquidity}
        className={`w-full py-3 rounded-xl font-pixel font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${isLong
          ? "text-black hover:brightness-110"
          : "text-white hover:brightness-110"
          }`}
        style={{
          background: isLong
            ? (!isConnected || isPending || collateralNum <= 0 || exceedsLiquidity)
              ? "#0a3d1a"
              : "linear-gradient(135deg, #00E676, #00C853)"
            : (!isConnected || isPending || collateralNum <= 0 || exceedsLiquidity)
              ? "#4a0000"
              : "linear-gradient(135deg, var(--trade-red), #D50000)",
          boxShadow: (!isConnected || isPending || collateralNum <= 0 || exceedsLiquidity)
            ? "none"
            : isLong
              ? "0 4px 16px rgba(0, 230, 118, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "0 4px 16px var(--trade-red-glow), inset 0 1px 0 rgba(255,255,255,0.1)",
        }}
      >
        {!isConnected
          ? "Connect Wallet"
          : isPending
            ? "Confirming..."
            : exceedsLiquidity
              ? "Insufficient Liquidity"
              : useP2P
                ? `P2P ${isLong ? "▲ Long" : "▼ Short"} $${collateralNum.toFixed(0)} Spot`
                : `${isLong ? "▲ Long" : "▼ Short"} ${sizeUsd.toFixed(0)} USD`}
      </button>
    </div>
  );
}

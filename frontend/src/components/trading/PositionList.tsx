"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { type Address, parseAbiItem, formatEther } from "viem";
import { CONTRACTS, TRADING_ABI } from "../../lib/contracts";

interface PositionData {
  positionId: `0x${string}`;
  feedId: number;
  isLong: boolean;
  collateral: bigint;
  sizeUsd: bigint;
  entryPrice: bigint;
  openTimestamp: bigint;
}

const FEED_NAMES: Record<number, string> = {
  2056: "Gold",
  2069: "Silver",
  2003: "Crude Oil",
  2062: "Platinum",
};

export function PositionList({
  prices,
}: {
  prices: { id: number; price: number }[];
}) {
  const { address } = useAccount();
  const { writeContract, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPositions = useCallback(async () => {
    if (!address || !publicClient || !CONTRACTS.trading) return;
    setLoading(true);

    try {
      // Get PositionOpened events for this user
      const logs = await publicClient.getLogs({
        address: CONTRACTS.trading as Address,
        event: parseAbiItem(
          "event PositionOpened(bytes32 indexed positionId, address indexed owner, uint16 feedId, bool isLong, uint256 collateral, uint256 sizeUsd, uint256 entryPrice)"
        ),
        args: { owner: address },
        fromBlock: 0n,
      });

      const positionPromises = logs.map(async (log) => {
        const posId = log.args.positionId!;
        const result = await publicClient.readContract({
          address: CONTRACTS.trading as Address,
          abi: TRADING_ABI,
          functionName: "getPosition",
          args: [posId],
        });

        const pos = result as {
          owner: Address;
          feedId: number;
          isLong: boolean;
          collateral: bigint;
          sizeUsd: bigint;
          entryPrice: bigint;
          openTimestamp: bigint;
          cumulativeBaseFeeSnapshot: bigint;
          cumulativeFundingSnapshot: bigint;
        };

        // Skip closed positions
        if (pos.collateral === 0n) return null;

        return {
          positionId: posId,
          feedId: Number(pos.feedId),
          isLong: pos.isLong,
          collateral: pos.collateral,
          sizeUsd: pos.sizeUsd,
          entryPrice: pos.entryPrice,
          openTimestamp: pos.openTimestamp,
        } as PositionData;
      });

      const results = await Promise.all(positionPromises);
      setPositions(results.filter((p): p is PositionData => p !== null));
    } catch {
      // Silently fail — trading contract may not be deployed
    }
    setLoading(false);
  }, [address, publicClient]);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 10_000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  const handleClose = (positionId: `0x${string}`) => {
    if (!CONTRACTS.trading) return;
    writeContract({
      address: CONTRACTS.trading as Address,
      abi: TRADING_ABI,
      functionName: "closePosition",
      args: [positionId],
    });
  };

  const getPnl = (pos: PositionData) => {
    const currentPriceData = prices.find((p) => p.id === pos.feedId);
    if (!currentPriceData || currentPriceData.price <= 0) return null;

    const entry = Number(pos.entryPrice) / 1e18;
    const current = currentPriceData.price;
    const leverage = Number(pos.sizeUsd) / Number(pos.collateral);
    const priceChange = pos.isLong
      ? (current - entry) / entry
      : (entry - current) / entry;
    const pnlPercent = priceChange * leverage * 100;
    const pnlUsd =
      (Number(pos.collateral) / 1e18) * priceChange * leverage;

    return { pnlPercent, pnlUsd };
  };

  // Liquidation price: price at which effective collateral drops to 30% of initial
  // Simplified formula (ignores fees/funding which accrue over time):
  //   For LONG:  liqPrice = entryPrice * (1 - (1 - maintenanceMargin) / leverage)
  //   For SHORT: liqPrice = entryPrice * (1 + (1 - maintenanceMargin) / leverage)
  const MAINTENANCE_MARGIN = 0.3; // 30% = 3000 bps

  const getLiquidationPrice = (pos: PositionData) => {
    const entry = Number(pos.entryPrice) / 1e18;
    const leverage = Number(pos.sizeUsd) / Number(pos.collateral);
    const moveToLiq = (1 - MAINTENANCE_MARGIN) / leverage;

    if (pos.isLong) {
      return entry * (1 - moveToLiq);
    } else {
      return entry * (1 + moveToLiq);
    }
  };

  if (!address) return null;

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">Open Positions</h3>
        <button
          onClick={fetchPositions}
          className="text-xs text-gray-400 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {loading && positions.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading positions...</p>
      ) : positions.length === 0 ? (
        <p className="text-gray-500 text-sm">No open positions</p>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const pnl = getPnl(pos);
            const leverage = Number(pos.sizeUsd) / Number(pos.collateral);

            return (
              <div
                key={pos.positionId}
                className="bg-gray-800 rounded-lg p-3 flex items-center justify-between"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        pos.isLong
                          ? "bg-green-900 text-green-400"
                          : "bg-red-900 text-red-400"
                      }`}
                    >
                      {pos.isLong ? "LONG" : "SHORT"}
                    </span>
                    <span className="text-white text-sm font-medium">
                      {FEED_NAMES[pos.feedId] ?? `Feed ${pos.feedId}`}
                    </span>
                    <span className="text-gray-400 text-xs">
                      {leverage.toFixed(1)}x
                    </span>
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-400">
                    <span>
                      Size: ${(Number(pos.sizeUsd) / 1e18).toFixed(0)}
                    </span>
                    <span>
                      Entry: ${(Number(pos.entryPrice) / 1e18).toFixed(2)}
                    </span>
                    <span>
                      Collateral: $
                      {(Number(pos.collateral) / 1e18).toFixed(2)}
                    </span>
                    <span className="text-orange-400">
                      Liq: ${getLiquidationPrice(pos).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {pnl && (
                    <div className="text-right">
                      <p
                        className={`text-sm font-mono ${
                          pnl.pnlUsd >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {pnl.pnlUsd >= 0 ? "+" : ""}
                        {pnl.pnlUsd.toFixed(2)} USD
                      </p>
                      <p
                        className={`text-xs ${
                          pnl.pnlPercent >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {pnl.pnlPercent >= 0 ? "+" : ""}
                        {pnl.pnlPercent.toFixed(2)}%
                      </p>
                    </div>
                  )}
                  <button
                    onClick={() => handleClose(pos.positionId)}
                    disabled={isPending}
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded disabled:opacity-50"
                  >
                    {isPending ? "..." : "Close"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

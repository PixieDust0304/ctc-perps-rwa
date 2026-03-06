"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import type { PositionUpdate } from "../../hooks/useWebSocket";

interface P2PPositionData {
  positionId: `0x${string}`;
  feedId: number;
  isLong: boolean;
  collateral: string;
  sizeUsd: string;
  entryPrice: string;
  status?: string;
}

const FEED_NAMES: Record<number, string> = {
  2056: "Gold",
  2069: "Silver",
  2003: "Crude Oil",
  2062: "Platinum",
};

export function P2PPositionList({
  onPositionUpdate,
}: {
  onPositionUpdate: (cb: (update: PositionUpdate) => void) => () => void;
}) {
  const { address } = useAccount();
  const [positions, setPositions] = useState<P2PPositionData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPositions = useCallback(async () => {
    if (!address) return;
    setLoading(true);

    try {
      const res = await fetch(
        `http://localhost:3001/api/positions/p2p?owner=${address}&status=open`
      );
      if (res.ok) {
        const data = await res.json();
        setPositions(
          data.map((row: any) => ({
            positionId: row.positionId as `0x${string}`,
            feedId: row.feedId,
            isLong: row.isLong,
            collateral: row.collateral?.toString() ?? "0",
            sizeUsd: row.sizeUsd?.toString() ?? "0",
            entryPrice: row.entryPrice?.toString() ?? "0",
            status: row.status,
          }))
        );
      }
    } catch {
      // API may not be available
    }
    setLoading(false);
  }, [address]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Subscribe to WebSocket P2P position updates
  useEffect(() => {
    if (!onPositionUpdate) return;

    const unsub = onPositionUpdate((update: PositionUpdate) => {
      if (update.positionType !== "p2p") return;

      if (update.action === "opened") {
        const pos = update.position;
        if (address && (pos.owner as string)?.toLowerCase() === address.toLowerCase()) {
          fetchPositions();
        }
      } else if (update.action === "settled" || update.action === "closed") {
        const posId = update.position.positionId as string;
        if (posId) {
          setPositions((prev) => prev.filter((p) => p.positionId !== posId));
        } else {
          // Batch settlement — refetch
          fetchPositions();
        }
      }
    });

    return unsub;
  }, [onPositionUpdate, address, fetchPositions]);

  if (!address) return null;
  if (positions.length === 0 && !loading) return null;

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">P2P Positions</h3>
        <button
          onClick={fetchPositions}
          className="text-xs text-gray-400 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {loading && positions.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading P2P positions...</p>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const collateral = Number(pos.collateral);
            const sizeUsd = Number(pos.sizeUsd);
            const leverage = collateral > 0 ? sizeUsd / collateral : 0;
            const entryUsd = Number(pos.entryPrice) / 1e18;

            return (
              <div
                key={pos.positionId}
                className="bg-gray-800 rounded-lg p-3 flex items-center justify-between"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-900 text-purple-400">
                      P2P
                    </span>
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
                      Size: ${(sizeUsd / 1e18).toFixed(0)}
                    </span>
                    <span>
                      VAMM Entry: ${entryUsd.toFixed(2)}
                    </span>
                    <span>
                      Collateral: $
                      {(collateral / 1e18).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-900 text-amber-400">
                    Pending Settlement
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-600 mt-2">
        P2P positions settle at market open with oracle price
      </p>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { type Address } from "viem";
import toast from "react-hot-toast";
import { CONTRACTS, TRADING_ABI } from "../../lib/contracts";
import { useContractWrite } from "../../hooks/useContractWrite";
import type { PositionUpdate } from "../../hooks/useWebSocket";

const MIN_OPEN_TIME_TRADING = 300; // seconds — must match Trading.sol
const MIN_OPEN_TIME_P2P = 10; // seconds — must match P2PTrading.sol

interface PositionData {
  positionId: `0x${string}`;
  feedId: number;
  isLong: boolean;
  collateral: string;
  sizeUsd: string;
  entryPrice: string;
  status?: string;
  type: "trading" | "p2p";
  openedAt?: string; // ISO string from DB or epoch seconds string from in-memory
}

type Tab = "trading" | "p2p" | "history";

const FEED_NAMES: Record<number, string> = {
  2056: "Gold",
  2069: "Silver",
  2003: "Crude Oil",
  2062: "Platinum",
};

export function PositionsPanel({
  prices,
  onPositionUpdate,
}: {
  prices: { id: number; price: number }[];
  onPositionUpdate: (cb: (update: PositionUpdate) => void) => () => void;
}) {
  const { address } = useAccount();
  const { execute, isPending } = useContractWrite();
  const [tab, setTab] = useState<Tab>("trading");
  const [tradingPositions, setTradingPositions] = useState<PositionData[]>([]);
  const [p2pPositions, setP2PPositions] = useState<PositionData[]>([]);
  const [historyPositions, setHistoryPositions] = useState<PositionData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTrading = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(
        `http://localhost:3001/api/positions?owner=${address}&status=open`
      );
      if (res.ok) {
        const data = await res.json();
        setTradingPositions(data.map((row: any) => mapRow(row, "trading")));
      }
    } catch {}
  }, [address]);

  const fetchP2P = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(
        `http://localhost:3001/api/positions/p2p?owner=${address}&status=open`
      );
      if (res.ok) {
        const data = await res.json();
        setP2PPositions(data.map((row: any) => mapRow(row, "p2p")));
      }
    } catch {}
  }, [address]);

  const fetchHistory = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(
        `http://localhost:3001/api/positions/history?owner=${address}`
      );
      if (res.ok) {
        const data = await res.json();
        setHistoryPositions(
          data.map((row: any) => mapRow(row, row.type ?? "trading"))
        );
      }
    } catch {}
  }, [address]);

  const fetchCurrent = useCallback(() => {
    setLoading(true);
    if (tab === "trading") fetchTrading().finally(() => setLoading(false));
    else if (tab === "p2p") fetchP2P().finally(() => setLoading(false));
    else fetchHistory().finally(() => setLoading(false));
  }, [tab, fetchTrading, fetchP2P, fetchHistory]);

  useEffect(() => {
    fetchCurrent();
  }, [fetchCurrent]);

  // WebSocket updates
  useEffect(() => {
    if (!onPositionUpdate) return;

    const unsub = onPositionUpdate((update: PositionUpdate) => {
      if (update.action === "opened") {
        const pos = update.position;
        if (
          address &&
          (pos.owner as string)?.toLowerCase() === address.toLowerCase()
        ) {
          if (update.positionType === "trading") fetchTrading();
          else fetchP2P();
        }
      } else if (
        update.action === "closed" ||
        update.action === "liquidated"
      ) {
        const posId = update.position.positionId as string;
        setTradingPositions((prev) =>
          prev.filter((p) => p.positionId !== posId)
        );
      } else if (update.action === "settled") {
        const posId = update.position.positionId as string;
        if (posId) {
          setP2PPositions((prev) =>
            prev.filter((p) => p.positionId !== posId)
          );
        } else {
          fetchP2P();
        }
      }
    });

    return unsub;
  }, [onPositionUpdate, address, fetchTrading, fetchP2P]);

  const handleClose = (pos: PositionData) => {
    if (!CONTRACTS.trading) return;

    // Pre-flight: check min open time before sending tx
    if (pos.openedAt) {
      const minTime = pos.type === "p2p" ? MIN_OPEN_TIME_P2P : MIN_OPEN_TIME_TRADING;
      const openedAtMs = pos.openedAt.includes("T")
        ? new Date(pos.openedAt).getTime() // ISO string from DB
        : Number(pos.openedAt) * 1000; // epoch seconds from in-memory
      const elapsedSec = Math.floor((Date.now() - openedAtMs) / 1000);
      const remaining = minTime - elapsedSec;
      if (remaining > 0) {
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        toast.error(`Cannot close yet — ${timeStr} remaining`);
        return;
      }
    }

    execute(
      {
        address: CONTRACTS.trading as Address,
        abi: TRADING_ABI,
        functionName: "closePosition",
        args: [pos.positionId],
      },
      "Closing position"
    );
  };

  const getPnl = (pos: PositionData) => {
    const currentPriceData = prices.find((p) => p.id === pos.feedId);
    if (!currentPriceData || currentPriceData.price <= 0) return null;
    const entry = Number(pos.entryPrice) / 1e18;
    const current = currentPriceData.price;
    const collateral = Number(pos.collateral);
    const sizeUsd = Number(pos.sizeUsd);
    if (collateral === 0) return null;
    const leverage = sizeUsd / collateral;
    const priceChange = pos.isLong
      ? (current - entry) / entry
      : (entry - current) / entry;
    return {
      pnlPercent: priceChange * leverage * 100,
      pnlUsd: (collateral / 1e18) * priceChange * leverage,
    };
  };

  const MAINTENANCE_MARGIN = 0.3;
  const getLiquidationPrice = (pos: PositionData) => {
    const entry = Number(pos.entryPrice) / 1e18;
    const collateral = Number(pos.collateral);
    const sizeUsd = Number(pos.sizeUsd);
    if (collateral === 0) return 0;
    const leverage = sizeUsd / collateral;
    const moveToLiq = (1 - MAINTENANCE_MARGIN) / leverage;
    return pos.isLong ? entry * (1 - moveToLiq) : entry * (1 + moveToLiq);
  };

  if (!address) return null;

  const positions =
    tab === "trading"
      ? tradingPositions
      : tab === "p2p"
        ? p2pPositions
        : historyPositions;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "trading", label: "Trading", count: tradingPositions.length },
    { key: "p2p", label: "P2P", count: p2pPositions.length },
    { key: "history", label: "History", count: historyPositions.length },
  ];

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t.key
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    tab === t.key
                      ? "bg-gray-600 text-gray-200"
                      : "bg-gray-800 text-gray-500"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={fetchCurrent}
          className="text-xs text-gray-400 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {loading && positions.length === 0 ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : positions.length === 0 ? (
        <p className="text-gray-500 text-sm">
          {tab === "history"
            ? "No position history"
            : `No open ${tab === "p2p" ? "P2P " : ""}positions`}
        </p>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const pnl = pos.status === "open" || !pos.status ? getPnl(pos) : null;
            const collateral = Number(pos.collateral);
            const sizeUsd = Number(pos.sizeUsd);
            const leverage = collateral > 0 ? sizeUsd / collateral : 0;
            const isOpen = pos.status === "open" || !pos.status;

            return (
              <div
                key={`${pos.type}-${pos.positionId}`}
                className={`bg-gray-800 rounded-lg p-3 flex items-center justify-between ${
                  !isOpen ? "opacity-60" : ""
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {pos.type === "p2p" && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-900 text-purple-400">
                        P2P
                      </span>
                    )}
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
                    {pos.status && pos.status !== "open" && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          pos.status === "closed"
                            ? "bg-gray-700 text-gray-400"
                            : pos.status === "liquidated"
                              ? "bg-red-900/50 text-red-400"
                              : "bg-amber-900/50 text-amber-400"
                        }`}
                      >
                        {pos.status}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-400">
                    <span>Size: ${(sizeUsd / 1e18).toFixed(0)}</span>
                    <span>
                      {pos.type === "p2p" ? "VAMM " : ""}Entry: $
                      {(Number(pos.entryPrice) / 1e18).toFixed(2)}
                    </span>
                    <span>
                      Collateral: ${(collateral / 1e18).toFixed(2)}
                    </span>
                    {pos.type === "trading" && isOpen && (
                      <span className="text-orange-400">
                        Liq: ${getLiquidationPrice(pos).toFixed(2)}
                      </span>
                    )}
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
                  {pos.type === "p2p" && isOpen && (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-900 text-amber-400">
                      Pending Settlement
                    </span>
                  )}
                  {pos.type === "trading" && isOpen && (
                    <button
                      onClick={() => handleClose(pos)}
                      disabled={isPending}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded disabled:opacity-50"
                    >
                      {isPending ? "..." : "Close"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "p2p" && positions.length > 0 && (
        <p className="text-xs text-gray-600 mt-2">
          P2P positions settle at market open with oracle price
        </p>
      )}
    </div>
  );
}

function mapRow(row: any, type: "trading" | "p2p"): PositionData {
  return {
    positionId: row.positionId as `0x${string}`,
    feedId: row.feedId,
    isLong: row.isLong,
    collateral: row.collateral?.toString() ?? "0",
    sizeUsd: row.sizeUsd?.toString() ?? "0",
    entryPrice: row.entryPrice?.toString() ?? "0",
    status: row.status,
    type,
    openedAt: row.openedAt ?? row.openTimestamp,
  };
}

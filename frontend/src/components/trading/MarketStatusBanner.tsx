"use client";

import { FEEDS } from "../../lib/contracts";
import type { MarketState } from "../../hooks/usePrices";

interface MarketStatusBannerProps {
  feedId: number;
  marketState: MarketState;
  reason?: string;
}

export function MarketStatusBanner({ feedId, marketState, reason }: MarketStatusBannerProps) {
  const feed = FEEDS.find((f) => f.id === feedId);
  const name = feed?.name ?? "Market";

  if (marketState === "OPEN") return null;

  if (marketState === "PAUSED") {
    return (
      <div className="bg-amber-900/50 border-b border-amber-700 px-4 py-2.5 text-center text-sm">
        <span className="text-amber-200">
          {name} data temporarily unavailable — trading <strong>paused</strong>.{" "}
          Prices will resume shortly. No trading is available during this period.
        </span>
      </div>
    );
  }

  // CLOSED — P2P trading active
  return (
    <div
      className="border-b px-4 py-2.5 text-center text-sm"
      style={{
        background: "rgba(168, 85, 247, 0.12)",
        borderColor: "rgba(168, 85, 247, 0.3)",
      }}
    >
      <span className="text-purple-200">
        {name} is currently{" "}
        <strong>CLOSED</strong> — Spot P2P Trading Active.{" "}
        You are trading against <strong>other traders</strong>, not the pool.
        All PnL is settled within the collective escrow of open positions.{" "}
        Prices reflect VAMM (virtual), not live oracle.
        Close anytime at VAMM price or hold for oracle settlement at market open.
      </span>
    </div>
  );
}

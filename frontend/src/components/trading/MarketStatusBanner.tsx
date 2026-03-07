"use client";

import { FEEDS } from "../../lib/contracts";

interface MarketStatusBannerProps {
  feedId: number;
  fresh: boolean;
}

export function MarketStatusBanner({ feedId, fresh }: MarketStatusBannerProps) {
  const feed = FEEDS.find((f) => f.id === feedId);

  if (fresh) return null;

  return (
    <div className="bg-amber-900/50 border-b border-amber-700 px-4 py-2.5 text-center text-sm">
      <span className="text-amber-200">
        {feed?.name ?? "Market"} is currently{" "}
        <strong>CLOSED</strong> — Spot P2P Trading Active.{" "}
        You are trading against <strong>other traders</strong>, not the pool.
        All PnL is settled within the collective escrow of open positions.{" "}
        Prices reflect VAMM (virtual), not live oracle.
        Close anytime at VAMM price or hold for oracle settlement at market open.
      </span>
    </div>
  );
}

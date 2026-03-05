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
    <div className="bg-amber-900/50 border-b border-amber-700 px-4 py-2 text-center text-sm">
      <span className="text-amber-200">
        {feed?.name ?? "Market"} is currently{" "}
        <strong>CLOSED</strong> — P2P trading mode active. Prices from VAMM,
        not oracle. Positions settle at market open.
      </span>
    </div>
  );
}

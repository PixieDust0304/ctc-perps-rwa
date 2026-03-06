"use client";

import { useReadContracts } from "wagmi";
import { formatEther, type Address } from "viem";
import { FEEDS, CUSTODY_ADDRESSES, CUSTODY_ABI } from "../../lib/contracts";
import { useState } from "react";

interface PriceInfo {
  id: number;
  name: string;
  symbol: string;
  price: number;
  fresh: boolean;
}

interface MarketSelectorProps {
  prices: PriceInfo[];
  selectedFeedId: number;
  onSelect: (feedId: number) => void;
}

export function MarketSelector({
  prices,
  selectedFeedId,
  onSelect,
}: MarketSelectorProps) {
  const [hoveredFeedId, setHoveredFeedId] = useState<number | null>(null);

  const custodyEntries = FEEDS.map((f) => ({
    feedId: f.id,
    address: CUSTODY_ADDRESSES[f.id] as Address | undefined,
  })).filter((e) => e.address);

  const { data: custodyData } = useReadContracts({
    contracts: custodyEntries.flatMap((e) => [
      {
        address: e.address!,
        abi: CUSTODY_ABI,
        functionName: "lpLiquidity" as const,
      },
      {
        address: e.address!,
        abi: CUSTODY_ABI,
        functionName: "reservedBalance" as const,
      },
    ]),
    query: { refetchInterval: 10000 },
  });

  function getCustodyInfo(feedId: number) {
    const idx = custodyEntries.findIndex((e) => e.feedId === feedId);
    if (idx === -1 || !custodyData) return null;
    const lpLiq = custodyData[idx * 2]?.result as bigint | undefined;
    const reserved = custodyData[idx * 2 + 1]?.result as bigint | undefined;
    if (!lpLiq) return null;
    const lp = Number(formatEther(lpLiq));
    const res = reserved ? Number(formatEther(reserved)) : 0;
    return { available: Math.max(lp - res, 0), reserved: res };
  }

  function formatUsd(n: number) {
    return n > 0
      ? "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : "$0";
  }

  return (
    <div className="px-4 pt-4 pb-2 overflow-visible">
      <div className="flex gap-1">
        {prices.map((feed) => {
          const custody = getCustodyInfo(feed.id);
          const isHovered = hoveredFeedId === feed.id;
          const titleText = custody
            ? `Avail. Liq: ${formatUsd(custody.available)}${custody.reserved > 0 ? ` (${formatUsd(custody.reserved)} reserved)` : ""}`
            : undefined;

          return (
            <div
              key={feed.id}
              className="relative"
              onMouseEnter={() => setHoveredFeedId(feed.id)}
              onMouseLeave={() => setHoveredFeedId(null)}
            >
              <button
                onClick={() => onSelect(feed.id)}
                title={titleText}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  selectedFeedId === feed.id
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                <span>{feed.name}</span>
                <span className="ml-2 font-mono">
                  ${feed.price > 0 ? feed.price.toFixed(2) : "---"}
                </span>
                <span
                  className={`ml-2 inline-block w-2 h-2 rounded-full ${
                    feed.fresh ? "bg-green-400" : "bg-red-400"
                  }`}
                />
              </button>

              {isHovered && custody && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 mt-1 z-[100] bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-xs whitespace-nowrap pointer-events-none"
                  style={{ top: "100%", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}
                >
                  <div className="text-gray-400 mb-1">Available Liquidity</div>
                  <div className="text-white font-mono">
                    {formatUsd(custody.available)}
                  </div>
                  {custody.reserved > 0 && (
                    <div className="text-gray-500 font-mono mt-0.5">
                      {formatUsd(custody.reserved)} reserved
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

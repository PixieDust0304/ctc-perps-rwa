"use client";

import { FEEDS } from "../../lib/contracts";
import { useReadContracts } from "wagmi";
import { formatEther, type Address } from "viem";
import { CONTRACTS, CUSTODY_ABI, CUSTODY_ADDRESSES } from "../../lib/contracts";
import { IconVault } from "../AppSidebar";

interface MarketSelectorProps {
  prices: { id: number; name: string; price: number; fresh: boolean; marketState: "OPEN" | "PAUSED" | "CLOSED" }[];
  selectedFeedId: number;
  onSelect: (id: number) => void;
}

/* Map feed names to their metallic badge class + emoji */
const COMMODITY_META: Record<string, { badge: string; emoji: string; label: string }> = {
  Gold: { badge: "badge-gold", emoji: "🥇", label: "Gold" },
  Silver: { badge: "badge-silver", emoji: "🥈", label: "Silver" },
  Platinum: { badge: "badge-platinum", emoji: "Pt", label: "Platinum" },
  "Crude Oil": { badge: "badge-crude", emoji: "🛢️", label: "Crude" },
};

export function MarketSelector({
  prices,
  selectedFeedId,
  onSelect,
}: MarketSelectorProps) {
  const selectedFeed = FEEDS.find((f) => f.id === selectedFeedId);
  const custodyAddress = selectedFeed
    ? CUSTODY_ADDRESSES[selectedFeed.id]
    : undefined;

  const { data: custodyData } = useReadContracts({
    contracts: custodyAddress ? [
      {
        address: custodyAddress as Address,
        abi: CUSTODY_ABI,
        functionName: "lpLiquidity" as const,
      },
      {
        address: custodyAddress as Address,
        abi: CUSTODY_ABI,
        functionName: "reservedBalance" as const,
      },
    ] : [],
    query: { refetchInterval: 5000 },
  });

  const lpLiq = custodyData?.[0]?.result as bigint | undefined;
  const reservedBal = custodyData?.[1]?.result as bigint | undefined;
  const liquidity = lpLiq !== undefined && reservedBal !== undefined
    ? Number(formatEther(lpLiq > reservedBal ? lpLiq - reservedBal : 0n))
    : 0;

  return (
    <div
      className="px-3 py-2"
      style={{ borderBottom: "1px solid var(--coal-border)" }}
    >
      <div className="flex items-center gap-2 overflow-x-auto">
        {FEEDS.map((feed) => {
          const price = prices.find((p) => p.id === feed.id);
          const meta = COMMODITY_META[feed.name] || { badge: "", emoji: "📈", label: feed.name };
          const isSelected = selectedFeedId === feed.id;
          const isStale = price ? price.marketState !== "OPEN" : false;

          return (
            <button
              key={feed.id}
              onClick={() => onSelect(feed.id)}
              className={`
                group flex items-center gap-2.5 px-4 py-2 rounded-xl transition-all whitespace-nowrap
                outline-none focus:outline-none focus-visible:outline-none
                ${isSelected ? "card-surface" : "hover:bg-white/[0.03]"}
              `}
              style={isSelected ? {
                background: "var(--coal-lighter)",
                border: "1px solid rgba(255, 212, 0, 0.15)",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3), 0 0 20px rgba(255, 212, 0, 0.05)",
              } : {
                border: "1px solid transparent",
              }}
            >
              {/* Metallic emoji badge */}
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${meta.badge}`}
                style={{
                  boxShadow: isSelected
                    ? `0 0 12px var(--pixel-yellow-glow)`
                    : undefined,
                }}
              >
                {meta.emoji}
              </div>

              {/* Name + Price */}
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-pixel font-semibold ${isSelected ? "text-white" : "text-gray-300"}`}>
                    {meta.label}
                  </span>
                  {/* Status dot */}
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: price?.marketState === "OPEN" ? "var(--profit-green)"
                        : price?.marketState === "PAUSED" ? "var(--pixel-yellow)"
                        : "var(--trade-red)",
                      boxShadow: price?.marketState === "OPEN" ? "0 0 4px var(--profit-green-glow)"
                        : price?.marketState === "PAUSED" ? "0 0 4px rgba(255, 212, 0, 0.4)"
                        : "0 0 4px var(--trade-red-glow)",
                    }}
                  />
                </div>
                <span className={`text-xs font-body ${isSelected ? "text-yellow-400" : "text-gray-500"}`}>
                  ${price?.price ? price.price.toFixed(2) : "---"}
                </span>
              </div>
            </button>
          );
        })}

        {/* Available Liquidity — Neon Gold Silver Beacon */}
        <div
          className="ml-auto flex items-center gap-3 px-5 py-2.5 rounded-xl relative overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #222222 0%, #151515 50%, #202020 100%)",
            border: "1px solid rgba(255, 212, 0, 0.4)",
            borderBottom: "2px solid rgba(255, 138, 0, 0.5)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.6), 0 0 20px rgba(255, 212, 0, 0.1), inset 0 2px 0 rgba(255,255,255,0.05)",
          }}
        >
          {/* Premium Gradient Search-light Beacon */}
          <div className="absolute inset-y-0 w-12 z-10"
            style={{
              animation: "laser-scan 12s cubic-bezier(0.4, 0, 0.2, 1) infinite",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.8), rgba(255,212,0,0.9), rgba(255,138,0,0.4), transparent)",
              boxShadow: "0 0 20px rgba(255,255,255,0.5), 0 0 40px rgba(255,212,0,0.8)",
              left: "0",
              opacity: 0.9,
              mixBlendMode: "overlay"
            }}
          />

          <div className="flex items-center gap-2.5 z-20">
            <div className="p-1.5 rounded-md bg-gradient-to-br from-[rgba(255,255,255,0.1)] to-transparent border border-[rgba(255,212,0,0.3)] text-[var(--pixel-yellow)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]">
              <IconVault size={16} />
            </div>
            <div className="flex flex-col">
              <span className="font-pixel text-[8px] uppercase tracking-wider opacity-60">
                NETWORK LIQUIDITY
              </span>
              <span className="font-body text-sm font-bold tracking-tight glow-text-brand">
                {liquidity > 0 ? `$${liquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

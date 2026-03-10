"use client";

import { useWebSocket } from "./useWebSocket";
import { FEEDS } from "../lib/contracts";
import type { MarketStateWsUpdate } from "./useWebSocket";

export type MarketState = "OPEN" | "PAUSED" | "CLOSED";

export interface PriceInfo {
  id: number;
  name: string;
  symbol: string;
  price: number;
  fresh: boolean;
  timestamp: number;
  isVammPrice: boolean;
  marketState: MarketState;
  marketStateReason?: string;
}

export function usePrices() {
  const { prices, vammPrices, marketStates, connected, onPositionUpdate } = useWebSocket();

  const formattedPrices: PriceInfo[] = FEEDS.map((feed) => {
    const data = prices[feed.id];
    const vammData = vammPrices[feed.id];
    const wsState = marketStates[feed.id];
    const isFresh = data?.fresh ?? false;

    // Derive market state: prefer WS three-state, fallback to fresh flag
    // Without WS state, stale data means PAUSED (not CLOSED) — we can't
    // distinguish CLOSED without the schedule-aware oracle telling us.
    let marketState: MarketState;
    if (wsState) {
      marketState = wsState.state;
    } else {
      marketState = isFresh ? "OPEN" : "PAUSED";
    }

    // OPEN: oracle price. PAUSED: last known (stale). CLOSED: VAMM price if available.
    const useVamm = marketState === "CLOSED" && !!vammData;
    const price18 = useVamm ? BigInt(vammData.price) : data ? BigInt(data.price) : 0n;
    const priceUsd = Number(price18) / 1e18;

    return {
      ...feed,
      price: priceUsd,
      fresh: isFresh,
      timestamp: useVamm ? vammData.timestamp : data?.timestamp ?? 0,
      isVammPrice: useVamm,
      marketState,
      marketStateReason: wsState?.reason,
    };
  });

  return { prices: formattedPrices, marketStates, connected, onPositionUpdate };
}

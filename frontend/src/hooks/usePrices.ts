"use client";

import { useWebSocket } from "./useWebSocket";
import { FEEDS } from "../lib/contracts";

export function usePrices() {
  const { prices, vammPrices, connected, onPositionUpdate } = useWebSocket();

  const formattedPrices = FEEDS.map((feed) => {
    const data = prices[feed.id];
    const vammData = vammPrices[feed.id];
    const isFresh = data?.fresh ?? false;

    // When market is closed (not fresh) and VAMM price exists, use VAMM price
    const useVamm = !isFresh && !!vammData;
    const price18 = useVamm ? BigInt(vammData.price) : data ? BigInt(data.price) : 0n;
    const priceUsd = Number(price18) / 1e18;

    return {
      ...feed,
      price: priceUsd,
      fresh: isFresh,
      timestamp: useVamm ? vammData.timestamp : data?.timestamp ?? 0,
      isVammPrice: useVamm,
    };
  });

  return { prices: formattedPrices, connected, onPositionUpdate };
}

"use client";

import { useWebSocket } from "./useWebSocket";
import { FEEDS } from "../lib/contracts";

export function usePrices() {
  const { prices, connected, onPositionUpdate } = useWebSocket();

  const formattedPrices = FEEDS.map((feed) => {
    const data = prices[feed.id];
    const price18 = data ? BigInt(data.price) : 0n;
    const priceUsd = Number(price18) / 1e18;
    return {
      ...feed,
      price: priceUsd,
      fresh: data?.fresh ?? false,
      timestamp: data?.timestamp ?? 0,
    };
  });

  return { prices: formattedPrices, connected, onPositionUpdate };
}

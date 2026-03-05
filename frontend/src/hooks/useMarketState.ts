"use client";

import { useReadContract } from "wagmi";
import { CONTRACTS, MARKET_STATE_ABI } from "../lib/contracts";
import type { Address } from "viem";

export function useMarketState(feedId: number) {
  const { data: isOpen } = useReadContract({
    address: CONTRACTS.marketState as Address,
    abi: MARKET_STATE_ABI,
    functionName: "isMarketOpen",
    args: [feedId],
    query: {
      enabled: !!CONTRACTS.marketState,
      refetchInterval: 5000,
    },
  });

  return { isOpen: isOpen ?? false };
}

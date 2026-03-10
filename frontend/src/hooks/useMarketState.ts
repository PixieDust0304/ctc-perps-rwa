"use client";

import { useReadContract } from "wagmi";
import { CONTRACTS, MARKET_STATE_ABI } from "../lib/contracts";
import type { Address } from "viem";
import type { MarketStateWsUpdate } from "./useWebSocket";

type MarketState = "OPEN" | "PAUSED" | "CLOSED";

/**
 * Three-state market state hook.
 * Primary: WS three-state from oracle service.
 * Fallback: on-chain RPC poll (two-state only — cannot distinguish PAUSED).
 */
export function useMarketState(
  feedId: number,
  wsMarketState?: MarketStateWsUpdate
) {
  // Fallback: on-chain poll (two-state)
  const { data: onChainIsOpen } = useReadContract({
    address: CONTRACTS.marketState as Address,
    abi: MARKET_STATE_ABI,
    functionName: "isMarketOpen",
    args: [feedId],
    query: {
      enabled: !!CONTRACTS.marketState && !wsMarketState,
      refetchInterval: 5000,
    },
  });

  // Prefer WS three-state when available
  if (wsMarketState) {
    return {
      state: wsMarketState.state,
      isOpen: wsMarketState.state === "OPEN",
      isPaused: wsMarketState.state === "PAUSED",
      isClosed: wsMarketState.state === "CLOSED",
      reason: wsMarketState.reason,
    };
  }

  // Fallback: on-chain two-state (cannot distinguish PAUSED from OPEN since
  // on-chain MarketState stays OPEN during PAUSED)
  const isOpen = (onChainIsOpen as boolean) ?? false;
  const state: MarketState = isOpen ? "OPEN" : "CLOSED";

  return {
    state,
    isOpen,
    isPaused: false, // Cannot detect from on-chain alone
    isClosed: !isOpen,
    reason: undefined as string | undefined,
  };
}

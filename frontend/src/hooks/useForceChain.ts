"use client";

import { useEffect } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { creditcoinLocal } from "../lib/chains";

/**
 * Force-switch connected wallets to the local Anvil chain.
 * If the chain isn't in the wallet, wagmi's switchChain will call
 * wallet_addEthereumChain automatically before switching.
 */
export function useForceChain() {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    if (isConnected && chainId !== creditcoinLocal.id) {
      switchChain({ chainId: creditcoinLocal.id });
    }
  }, [isConnected, chainId, switchChain]);
}

"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "../lib/wagmiConfig";
import { creditcoinLocal } from "../lib/chains";
import { useForceChain } from "../hooks/useForceChain";
import { Toaster } from "react-hot-toast";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

function ChainEnforcer({ children }: { children: React.ReactNode }) {
  useForceChain();
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()} initialChain={creditcoinLocal}>
          <ChainEnforcer>{children}</ChainEnforcer>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: { background: "#1f2937", color: "#fff", border: "1px solid #374151" },
              success: { iconTheme: { primary: "#22c55e", secondary: "#fff" } },
              error: { iconTheme: { primary: "#ef4444", secondary: "#fff" } },
            }}
          />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

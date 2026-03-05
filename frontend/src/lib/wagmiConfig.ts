"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { creditcoinLocal } from "./chains";

export const wagmiConfig = getDefaultConfig({
  appName: "CTC Perps",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "b56e18d47c72ab683b10814fe9495694",
  chains: [creditcoinLocal],
  ssr: true,
});

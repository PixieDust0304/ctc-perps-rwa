"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { creditcoinLocal } from "./chains";

export const wagmiConfig = getDefaultConfig({
  appName: "CTC Perps",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "demo",
  chains: [creditcoinLocal],
  ssr: true,
});

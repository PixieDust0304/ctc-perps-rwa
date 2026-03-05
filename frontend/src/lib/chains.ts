import { defineChain } from "viem";

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

export const creditcoinLocal = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337"),
  name: "CTC Perps (Anvil)",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
  testnet: true,
});

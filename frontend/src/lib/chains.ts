import { defineChain } from "viem";

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");

export const creditcoinLocal = defineChain({
  id: chainId,
  name: chainId === 102031
    ? "CreditCoin Testnet"
    : chainId === 102030
      ? "CreditCoin"
      : "pErp-man (Anvil)",
  nativeCurrency: { name: "CTC", symbol: "CTC", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
  testnet: chainId !== 102030,
});

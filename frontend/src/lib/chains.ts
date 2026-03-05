import { defineChain } from "viem";

export const creditcoinLocal = defineChain({
  id: 31337,
  name: "CreditCoin Local",
  nativeCurrency: { name: "CTC", symbol: "CTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});

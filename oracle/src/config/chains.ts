import { defineChain } from "viem";

export const creditcoinLocal = defineChain({
  id: 31337,
  name: "CreditCoin Local",
  nativeCurrency: { name: "CTC", symbol: "CTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});

export const creditcoinTestnet = defineChain({
  id: 102031,
  name: "CreditCoin Testnet",
  nativeCurrency: { name: "CTC", symbol: "CTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.cc3-testnet.creditcoin.network"] },
  },
  blockExplorers: {
    default: {
      name: "CreditCoin Explorer",
      url: "https://creditcoin.blockscout.com",
    },
  },
});

export const creditcoinMainnet = defineChain({
  id: 102030,
  name: "CreditCoin",
  nativeCurrency: { name: "CTC", symbol: "CTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://mainnet3.creditcoin.network"],
      webSocket: ["wss://mainnet3.creditcoin.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "CreditCoin Explorer",
      url: "https://creditcoin.blockscout.com",
    },
  },
});

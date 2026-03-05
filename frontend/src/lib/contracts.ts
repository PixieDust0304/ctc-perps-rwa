// Contract addresses — populated after deploy
export const CONTRACTS = {
  mockUSDC: process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS || "",
  clp: process.env.NEXT_PUBLIC_CLP_ADDRESS || "",
  cperp: process.env.NEXT_PUBLIC_CPERP_ADDRESS || "",
  oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS || "",
  pool: process.env.NEXT_PUBLIC_POOL_ADDRESS || "",
  trading: process.env.NEXT_PUBLIC_TRADING_ADDRESS || "",
  p2pTrading: process.env.NEXT_PUBLIC_P2P_TRADING_ADDRESS || "",
  vamm: process.env.NEXT_PUBLIC_VAMM_ADDRESS || "",
  feeManager: process.env.NEXT_PUBLIC_FEE_MANAGER_ADDRESS || "",
  marketState: process.env.NEXT_PUBLIC_MARKET_STATE_ADDRESS || "",
  governance: process.env.NEXT_PUBLIC_GOVERNANCE_ADDRESS || "",
} as const;

// Custody addresses per feed
function parseCustodyAddresses(): Record<number, string> {
  try {
    const json = process.env.NEXT_PUBLIC_CUSTODY_ADDRESSES;
    if (!json) return {};
    const parsed = JSON.parse(json);
    const result: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      result[Number(k)] = v as string;
    }
    return result;
  } catch {
    return {};
  }
}

export const CUSTODY_ADDRESSES = parseCustodyAddresses();

// Feed config
export const FEEDS = [
  { id: 2056, name: "Gold", symbol: "XAU" },
  { id: 2069, name: "Silver", symbol: "XAG" },
  { id: 2003, name: "Crude Oil", symbol: "CL1" },
  { id: 2062, name: "Platinum", symbol: "XPT" },
] as const;

// Minimal ABIs for frontend interaction
export const TRADING_ABI = [
  {
    name: "openPosition",
    type: "function",
    inputs: [
      { name: "feedId", type: "uint16" },
      { name: "isLong", type: "bool" },
      { name: "collateral", type: "uint256" },
      { name: "leverage", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "closePosition",
    type: "function",
    inputs: [{ name: "positionId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getPosition",
    type: "function",
    inputs: [{ name: "positionId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "feedId", type: "uint16" },
          { name: "isLong", type: "bool" },
          { name: "collateral", type: "uint256" },
          { name: "sizeUsd", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "openTimestamp", type: "uint256" },
          { name: "cumulativeBaseFeeSnapshot", type: "uint256" },
          { name: "cumulativeFundingSnapshot", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const POOL_ABI = [
  {
    name: "deposit",
    type: "function",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "withdraw",
    type: "function",
    inputs: [{ name: "clpAmount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "totalPoolUSDC",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "allowance",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const MARKET_STATE_ABI = [
  {
    name: "isMarketOpen",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

export const CUSTODY_ABI = [
  {
    name: "availableBalance",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const MOCK_USDC_ABI = [
  ...ERC20_ABI,
  {
    name: "faucet",
    type: "function",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

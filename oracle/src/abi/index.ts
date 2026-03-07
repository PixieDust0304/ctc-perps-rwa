// Contract ABIs for keeper system — extracted from contracts/out/ forge artifacts

export const TradingABI = [
  {
    name: "liquidate",
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
          { name: "cumulativeFundingSnapshot", type: "int256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    name: "maintenanceMarginBps",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Events
  {
    type: "event",
    name: "PositionOpened",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "feedId", type: "uint16", indexed: false },
      { name: "isLong", type: "bool", indexed: false },
      { name: "collateral", type: "uint256", indexed: false },
      { name: "sizeUsd", type: "uint256", indexed: false },
      { name: "entryPrice", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PositionClosed",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "realizedPnl", type: "int256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PositionLiquidated",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "liquidator", type: "address", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CollateralAdded",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "newCollateral", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const P2PTradingABI = [
  {
    name: "positions",
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
          { name: "isSettled", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    name: "settleP2PBatch",
    type: "function",
    inputs: [
      { name: "positionIds", type: "bytes32[]" },
      { name: "settlementPrice", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getFeedPositionCount",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "feedPositionIds",
    type: "function",
    inputs: [
      { name: "", type: "uint16" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    name: "closeP2PPosition",
    type: "function",
    inputs: [{ name: "positionId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "sweepLeftoverUSDC",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Events
  {
    type: "event",
    name: "P2PPositionOpened",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "feedId", type: "uint16", indexed: false },
      { name: "isLong", type: "bool", indexed: false },
      { name: "collateral", type: "uint256", indexed: false },
      { name: "sizeUsd", type: "uint256", indexed: false },
      { name: "entryVammPrice", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "P2PPositionClosed",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "realizedPnl", type: "int256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "P2PBatchSettled",
    inputs: [
      { name: "feedId", type: "uint16", indexed: true },
      { name: "settledCount", type: "uint256", indexed: false },
      { name: "settlementPrice", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const CustodyABI = [
  {
    name: "accrueFees",
    type: "function",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "feedId",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
    stateMutability: "view",
  },
  {
    name: "lpLiquidity",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "cumulativeLongBaseFeePerUnit",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "cumulativeShortBaseFeePerUnit",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "cumulativeFundingPerUnit",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "int256" }],
    stateMutability: "view",
  },
  {
    name: "longOpenInterest",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "shortOpenInterest",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const OracleABI = [
  {
    name: "updatePrices",
    type: "function",
    inputs: [
      { name: "feedIds", type: "uint16[]" },
      { name: "rawPrices", type: "uint256[]" },
      { name: "timestamps", type: "uint256[]" },
      { name: "freshFlags", type: "bool[]" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getPrice",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "price", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "fresh", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const MarketStateABI = [
  {
    name: "updateState",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "isMarketOpen",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

export const VAMMABI = [
  {
    name: "initializeVAMM",
    type: "function",
    inputs: [
      { name: "feedId", type: "uint16" },
      { name: "spotPrice", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "deactivateVAMM",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getVAMMPrice",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "vamms",
    type: "function",
    inputs: [{ name: "feedId", type: "uint16" }],
    outputs: [
      { name: "virtualBase", type: "uint256" },
      { name: "virtualQuote", type: "uint256" },
      { name: "k", type: "uint256" },
      { name: "depthMultiplier", type: "uint256" },
      { name: "active", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    name: "setDepthMultiplier",
    type: "function",
    inputs: [
      { name: "feedId", type: "uint16" },
      { name: "multiplier", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

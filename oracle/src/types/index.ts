export interface AutonomPrice {
  feed_id: number;
  price: number; // raw integer, expo = -10
  expo: number;
  timestamp: number; // ms
}

export interface AutonomError {
  feed_id: number;
  code: string;
  message: string;
}

export interface AutonomResponse {
  prices: AutonomPrice[];
  errors?: AutonomError[];
  signature: string;
  recovery_id: number;
  served_at: number;
  request: {
    fresh: boolean;
    prefer_cache: boolean;
    allow_stale_on_error: boolean;
    include_eth: boolean;
  };
  kid: string;
  version: number;
}

export interface PriceTick {
  feedId: number;
  price: bigint; // 18-decimal
  rawPrice: bigint;
  timestamp: number; // ms
  fresh: boolean;
  source?: "oracle" | "vamm";
  errorCode?: string; // Autonom error code (e.g. "MARKET_CLOSED", "SELECTION_FAILED")
}

export type MarketState = "OPEN" | "PAUSED" | "CLOSED";

export interface MarketStateUpdate {
  feedId: number;
  /** Three-state: OPEN (oracle trading), PAUSED (no trading), CLOSED (P2P trading) */
  state: MarketState;
  /** Backward-compatible: true only when state === "OPEN" */
  isOpen: boolean;
  /** The effective state before this transition (looks through PAUSED to the real prior state) */
  previousState?: MarketState;
  timestamp: number;
  reason?: string;
}

export interface WebSocketMessage {
  type: "price" | "marketState" | "candle" | "position" | "vammPrice";
  data: unknown;
}

export interface CandleData {
  feedId: number;
  interval: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  source: string;
  timestamp: number;
}

export interface Position {
  id: `0x${string}`;
  owner: `0x${string}`;
  feedId: number;
  isLong: boolean;
  collateral: bigint;
  sizeUsd: bigint;
  entryPrice: bigint;
  openTimestamp: bigint;
  cumulativeBaseFeeSnapshot: bigint;
  cumulativeFundingSnapshot: bigint;
}

export interface P2PPosition {
  id: `0x${string}`;
  owner: `0x${string}`;
  feedId: number;
  isLong: boolean;
  collateral: bigint;
  sizeUsd: bigint;
  entryPrice: bigint;
  openTimestamp: bigint;
  isSettled: boolean;
}

export interface CustodyState {
  cumulativeLongBaseFeePerUnit: bigint;
  cumulativeShortBaseFeePerUnit: bigint;
  cumulativeFundingPerUnit: bigint;
}

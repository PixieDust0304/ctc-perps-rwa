export interface AutonomPrice {
  feed_id: number;
  price: number; // raw integer, expo = -10
  expo: number;
  timestamp: number; // ms
}

export interface AutonomResponse {
  prices: AutonomPrice[];
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
}

export interface MarketStateUpdate {
  feedId: number;
  isOpen: boolean;
  timestamp: number;
}

export interface WebSocketMessage {
  type: "price" | "marketState" | "candle";
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
  timestamp: number;
}

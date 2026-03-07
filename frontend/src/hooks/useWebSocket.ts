"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface PriceUpdate {
  feedId: number;
  price: string;
  timestamp: number;
  fresh: boolean;
}

export interface PositionUpdate {
  action: "opened" | "closed" | "liquidated" | "settled" | "collateralAdded";
  positionType: "trading" | "p2p";
  position: Record<string, unknown>;
}

type PositionCallback = (update: PositionUpdate) => void;

export interface VammPriceUpdate {
  feedId: number;
  price: string;
  timestamp: number;
}

export function useWebSocket(url: string = "ws://localhost:8080") {
  const [prices, setPrices] = useState<Record<number, PriceUpdate>>({});
  const [vammPrices, setVammPrices] = useState<Record<number, VammPriceUpdate>>({});
  const [connected, setConnected] = useState(false);
  const positionCallbacksRef = useRef<Set<PositionCallback>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  const onPositionUpdate = useCallback((cb: PositionCallback) => {
    positionCallbacksRef.current.add(cb);
    return () => {
      positionCallbacksRef.current.delete(cb);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        // onclose will fire after this, triggering reconnect
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "price") {
            const updates = msg.data as PriceUpdate[];
            setPrices((prev) => {
              const next = { ...prev };
              for (const u of updates) {
                next[u.feedId] = u;
              }
              return next;
            });
          } else if (msg.type === "vammPrice") {
            const updates = msg.data as VammPriceUpdate[];
            setVammPrices((prev) => {
              const next = { ...prev };
              for (const u of updates) {
                next[u.feedId] = u;
              }
              return next;
            });
          } else if (msg.type === "position") {
            const update = msg.data as PositionUpdate;
            for (const cb of positionCallbacksRef.current) {
              cb(update);
            }
          }
        } catch {
          // ignore parse errors
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [url]);

  return { prices, vammPrices, connected, onPositionUpdate };
}

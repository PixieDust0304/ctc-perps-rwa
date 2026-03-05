"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface PriceUpdate {
  feedId: number;
  price: string;
  timestamp: number;
  fresh: boolean;
}

export function useWebSocket(url: string = "ws://localhost:8080") {
  const [prices, setPrices] = useState<Record<number, PriceUpdate>>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 2s
      setTimeout(() => {
        wsRef.current = new WebSocket(url);
      }, 2000);
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
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      ws.close();
    };
  }, [url]);

  return { prices, connected };
}

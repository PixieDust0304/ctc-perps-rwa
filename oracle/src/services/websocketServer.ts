import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { PriceTick, MarketStateUpdate, WebSocketMessage } from "../types/index.js";

let wss: WebSocketServer | null = null;

export function startWebSocketServer(): WebSocketServer {
  wss = new WebSocketServer({ port: config.wsPort });

  wss.on("connection", (ws) => {
    logger.info("WebSocket", "Client connected");
    ws.on("close", () => logger.info("WebSocket", "Client disconnected"));
    ws.on("error", (err) => logger.error("WebSocket", `Client error: ${err.message}`));
  });

  logger.info("WebSocket", `Server started on port ${config.wsPort}`);
  return wss;
}

function broadcast(message: WebSocketMessage) {
  if (!wss) return;
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export function broadcastPrices(ticks: PriceTick[]) {
  broadcast({
    type: "price",
    data: ticks.map((t) => ({
      feedId: t.feedId,
      price: t.price.toString(),
      timestamp: t.timestamp,
      fresh: t.fresh,
    })),
  });
}

export function broadcastMarketState(updates: MarketStateUpdate[]) {
  for (const update of updates) {
    broadcast({
      type: "marketState",
      data: update,
    });
  }
}

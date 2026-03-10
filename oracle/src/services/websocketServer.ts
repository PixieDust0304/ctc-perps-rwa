import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { PriceTick, MarketStateUpdate, MarketState, WebSocketMessage } from "../types/index.js";
import { getMarketState } from "./marketStateDetector.js";

let wss: WebSocketServer | null = null;

export function startWebSocketServer(server?: HttpServer): WebSocketServer {
  wss = server
    ? new WebSocketServer({ server })
    : new WebSocketServer({ port: config.wsPort });

  wss.on("connection", (ws) => {
    logger.info("WebSocket", "Client connected");

    // Send current market state for all feeds on connect so clients don't miss initial state
    for (const feedId of config.feedIds) {
      const state: MarketState = getMarketState(feedId);
      const msg: WebSocketMessage = {
        type: "marketState",
        data: {
          feedId,
          state,
          isOpen: state === "OPEN",
          timestamp: Date.now(),
        },
      };
      ws.send(JSON.stringify(msg));
    }

    ws.on("close", () => logger.info("WebSocket", "Client disconnected"));
    ws.on("error", (err) => logger.error("WebSocket", `Client error: ${err.message}`));
  });

  const listenInfo = server ? "attached to HTTP server" : `standalone on port ${config.wsPort}`;
  logger.info("WebSocket", `Server started (${listenInfo})`);
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
      data: {
        feedId: update.feedId,
        state: update.state,
        isOpen: update.isOpen,
        timestamp: update.timestamp,
        reason: update.reason,
      },
    });
  }
}

export function broadcastVammPrices(data: { feedId: number; price: string; timestamp: number }[]) {
  broadcast({
    type: "vammPrice",
    data,
  });
}

export function broadcastPositionUpdate(
  action: "opened" | "closed" | "liquidated" | "settled" | "collateralAdded",
  positionType: "trading" | "p2p",
  position: Record<string, unknown>
) {
  broadcast({
    type: "position",
    data: { action, positionType, position },
  });
}

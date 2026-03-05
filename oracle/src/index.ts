import { config } from "./config/index.js";
import { startFetcher } from "./services/fetcher.js";
import { pushPrices } from "./services/chainPusher.js";
import { storePriceTicks, getCandles, getCandlesAsync, getLatestPrice } from "./services/priceStore.js";
import { detectMarketStateChanges } from "./services/marketStateDetector.js";
import { initDatabase } from "./services/database.js";
import {
  startWebSocketServer,
  broadcastPrices,
  broadcastMarketState,
} from "./services/websocketServer.js";
import { startMainKeeper } from "./keepers/mainKeeper.js";
import { handleMarketOpen } from "./keepers/marketOpenKeeper.js";
import { logger } from "./utils/logger.js";
import express from "express";
import cors from "cors";
import type { PriceTick } from "./types/index.js";

async function main() {
  logger.info("Main", "CTC-Perps Oracle Service starting...");
  logger.info("Main", `Autonom URL: ${config.autonomUrl}`);
  logger.info("Main", `RPC URL: ${config.rpcUrl}`);
  logger.info("Main", `Feed IDs: ${config.feedIds.join(", ")}`);

  // Initialize database (optional — falls back to in-memory)
  const dbReady = await initDatabase();
  logger.info("Main", `Database: ${dbReady ? "PostgreSQL connected" : "in-memory mode"}`);

  // Start WebSocket server
  startWebSocketServer();

  // Start REST API
  const app = express();
  app.use(cors());

  app.get("/api/candles/:feedId/:interval", async (req, res) => {
    const feedId = parseInt(req.params.feedId);
    const interval = req.params.interval;
    const limit = parseInt((req.query.limit as string) || "100");
    const candles = await getCandlesAsync(feedId, interval, limit);
    res.json(candles);
  });

  // Also support query-param style: /api/candles?feedId=2056&interval=1m
  app.get("/api/candles", async (req, res) => {
    const feedId = parseInt((req.query.feedId as string) || "0");
    const interval = (req.query.interval as string) || "1m";
    const limit = parseInt((req.query.limit as string) || "100");
    if (!feedId) {
      res.status(400).json({ error: "feedId required" });
      return;
    }
    const candles = await getCandlesAsync(feedId, interval, limit);
    res.json(candles);
  });

  app.get("/api/price/:feedId", (req, res) => {
    const feedId = parseInt(req.params.feedId);
    const latest = getLatestPrice(feedId);
    if (latest) {
      res.json({
        feedId: latest.feedId,
        price: latest.price.toString(),
        timestamp: latest.timestamp,
        fresh: latest.fresh,
      });
    } else {
      res.status(404).json({ error: "No price data" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.listen(config.apiPort, () => {
    logger.info("API", `REST API listening on port ${config.apiPort}`);
  });

  // Start price fetcher with processing pipeline
  startFetcher(async (ticks: PriceTick[]) => {
    // 1. Store in memory/DB
    storePriceTicks(ticks);

    // 2. Broadcast to WebSocket clients
    broadcastPrices(ticks);

    // 3. Detect market state changes
    const stateChanges = detectMarketStateChanges(ticks);
    if (stateChanges.length > 0) {
      broadcastMarketState(stateChanges);

      // Handle market opens (settlement)
      await handleMarketOpen(stateChanges);
    }

    // 4. Push to chain (if configured)
    if (config.oracleAddress) {
      await pushPrices(ticks);
    }
  });

  // Start main keeper (liquidations)
  startMainKeeper();

  logger.info("Main", "Oracle service running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  logger.error("Main", `Fatal error: ${err.message}`);
  process.exit(1);
});

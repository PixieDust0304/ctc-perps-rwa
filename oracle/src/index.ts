import { config } from "./config/index.js";
import { startFetcher } from "./services/fetcher.js";
import { pushPrices } from "./services/chainPusher.js";
import { storePriceTicks, getCandlesAsync, getLatestPrice, getPriceMovement } from "./services/priceStore.js";
import { detectMarketStateChanges } from "./services/marketStateDetector.js";
import { initDatabase, queryPositions, queryPositionsByType, getPrisma, logMarketState } from "./services/database.js";
import {
  startWebSocketServer,
  broadcastPrices,
  broadcastMarketState,
} from "./services/websocketServer.js";
import {
  initPositions,
  startWatching,
  getOpenPositions,
  getOpenP2PPositions,
  getPositionsForOwner,
  getP2PPositionsForOwner,
} from "./keepers/positionTracker.js";
import { reconcile } from "./keepers/positionReconciler.js";
import { handleMarketOpenSettlement } from "./keepers/p2pSettlementKeeper.js";
import { logger } from "./utils/logger.js";
import express from "express";
import cors from "cors";
import type { PriceTick } from "./types/index.js";

function serializeBigints(obj: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return result;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && typeof v === "object" && "toString" in v) {
      // Prisma Decimal
      result[k] = v.toString();
    } else if (v instanceof Date) {
      result[k] = v.toISOString();
    } else {
      result[k] = v;
    }
  }
  return result;
}

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

  app.get("/api/movement/:feedId", (req, res) => {
    const feedId = parseInt(req.params.feedId);
    const lookback = parseInt((req.query.lookback as string) || "60000");
    const result = getPriceMovement(feedId, lookback);
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: "No data for this timeframe" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Position endpoints
  app.get("/api/positions", async (req, res) => {
    const owner = req.query.owner as string | undefined;
    const status = req.query.status as string | undefined;
    const feedId = req.query.feedId ? parseInt(req.query.feedId as string) : undefined;

    if (getPrisma()) {
      const rows = await queryPositionsByType("trading", owner, status);
      res.json(rows.map(serializeRow));
    } else {
      // Fallback: in-memory (open only)
      const positions = owner ? getPositionsForOwner(owner) : getOpenPositions(feedId);
      res.json(positions.map(serializeBigints));
    }
  });

  app.get("/api/positions/p2p", async (req, res) => {
    const owner = req.query.owner as string | undefined;
    const status = req.query.status as string | undefined;

    if (getPrisma()) {
      const rows = await queryPositionsByType("p2p", owner, status);
      res.json(rows.map(serializeRow));
    } else {
      const positions = owner ? getP2PPositionsForOwner(owner) : getOpenP2PPositions();
      res.json(positions.map(serializeBigints));
    }
  });

  app.get("/api/positions/history", async (req, res) => {
    const owner = req.query.owner as string | undefined;
    const feedId = req.query.feedId ? parseInt(req.query.feedId as string) : undefined;

    if (getPrisma()) {
      const rows = await queryPositions(owner, feedId);
      res.json(rows.map(serializeRow));
    } else {
      // In-memory: can only return open positions
      const trading = owner ? getPositionsForOwner(owner) : getOpenPositions(feedId);
      const p2p = owner ? getP2PPositionsForOwner(owner) : getOpenP2PPositions();
      res.json([...trading.map(serializeBigints), ...p2p.map(serializeBigints)]);
    }
  });

  app.listen(config.apiPort, () => {
    logger.info("API", `REST API listening on port ${config.apiPort}`);
  });

  // Initialize position tracker (DB-backed or chain replay + live watchers)
  try {
    await initPositions();
    startWatching();
  } catch (err) {
    logger.warn("Main", `Position tracker init failed: ${(err as Error).message}`);
  }

  // Start reconciler: every 30 minutes
  if (getPrisma()) {
    setInterval(reconcile, 30 * 60 * 1000);
    logger.info("Main", "Position reconciler scheduled (every 30 min)");
  }

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

      // Log market state transitions to DB
      for (const sc of stateChanges) {
        const tick = ticks.find(t => t.feedId === sc.feedId);
        logMarketState(sc.feedId, sc.isOpen ? "open" : "closed", tick?.price.toString() ?? null, new Date(sc.timestamp));
      }

      // Handle market opens (P2P settlement with coordinator lock)
      await handleMarketOpenSettlement(stateChanges);
    }

    // 4. Push to chain + post-push hooks (fee accrual + liquidation in same tick)
    if (config.oracleAddress) {
      await pushPrices(ticks);
    }
  });

  logger.info("Main", "Oracle service running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  logger.error("Main", `Fatal error: ${err.message}`);
  process.exit(1);
});

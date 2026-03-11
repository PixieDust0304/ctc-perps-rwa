import { config } from "./config/index.js";
import { startFetcher } from "./services/fetcher.js";
import { pushPrices, initOnChainState } from "./services/chainPusher.js";
import { maybeTriggerAccrual } from "./keepers/feeAccrualKeeper.js";
import { storePriceTicks, getCandlesAsync, getLatestPrice, getPriceMovement } from "./services/priceStore.js";
import { detectMarketStateChanges, getMarketState } from "./services/marketStateDetector.js";
import { initDatabase, queryPositions, queryPositionsByType, queryMarketStates, getPrisma, logMarketState } from "./services/database.js";
import {
  startWebSocketServer,
  broadcastPrices,
  broadcastMarketState,
  broadcastVammPrices,
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
import { createServer } from "http";
import { createPublicClient, http, type Hex } from "viem";
import { getChain } from "./config/chains.js";
import { VAMMABI, MarketStateABI } from "./abi/index.js";
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
    if (v instanceof Date) {
      result[k] = v.toISOString();
    } else if (v !== null && typeof v === "object" && "toString" in v) {
      // Prisma Decimal
      result[k] = v.toString();
    } else {
      result[k] = v;
    }
  }
  return result;
}

async function main() {
  logger.info("Main", "pErp-man Oracle Service starting...");
  logger.info("Main", `Autonom URL: ${config.autonomUrl}`);
  logger.info("Main", `RPC URL: ${config.rpcUrl}`);
  logger.info("Main", `Feed IDs: ${config.feedIds.join(", ")}`);
  logger.info("Main", `Block time: ${config.blockTimeMs}ms (chain push, log poll, reconciler derive from this)`);

  // Initialize database (optional — falls back to in-memory)
  const dbReady = await initDatabase();
  logger.info("Main", `Database: ${dbReady ? "PostgreSQL connected" : "in-memory mode"}`);

  // Start REST API
  const app = express();
  app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
    credentials: true,
  }));
  const httpServer = createServer(app);

  // Attach WebSocket to the HTTP server (single port for Render compatibility)
  // Falls back to standalone WS port when no HTTP server is passed (local dev with separate ports)
  startWebSocketServer(httpServer);

  app.get("/api/candles/:feedId/:interval", async (req, res) => {
    const feedId = parseInt(req.params.feedId);
    const interval = req.params.interval;
    const limit = parseInt((req.query.limit as string) || "500");
    const before = req.query.before ? parseInt(req.query.before as string) : undefined;
    const candles = await getCandlesAsync(feedId, interval, limit, before);
    res.json(candles);
  });

  // Also support query-param style: /api/candles?feedId=2056&interval=1m
  app.get("/api/candles", async (req, res) => {
    const feedId = parseInt((req.query.feedId as string) || "0");
    const interval = (req.query.interval as string) || "1m";
    const limit = parseInt((req.query.limit as string) || "500");
    const before = req.query.before ? parseInt(req.query.before as string) : undefined;
    if (!feedId) {
      res.status(400).json({ error: "feedId required" });
      return;
    }
    const candles = await getCandlesAsync(feedId, interval, limit, before);
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

  app.get("/api/market-state/:feedId", (req, res) => {
    const feedId = parseInt(req.params.feedId);
    const state = getMarketState(feedId);
    res.json({
      feedId,
      state,
      isOpen: state === "OPEN",
      isPaused: state === "PAUSED",
      isClosed: state === "CLOSED",
    });
  });

  app.get("/api/market-states", async (req, res) => {
    const feedId = parseInt((req.query.feedId as string) || "0");
    const limit = parseInt((req.query.limit as string) || "100");
    if (!feedId) {
      res.status(400).json({ error: "feedId required" });
      return;
    }
    const rows = await queryMarketStates(feedId, limit);
    res.json(rows);
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

  httpServer.listen(config.apiPort, () => {
    logger.info("API", `REST API + WebSocket listening on port ${config.apiPort}`);
  });

  // Initialize position tracker (DB-backed or chain replay + live watchers)
  try {
    await initPositions();
  } catch (err) {
    logger.warn("Main", `Position tracker init failed (will rely on reconciler + poller): ${(err as Error).message.slice(0, 200)}`);
  }
  // ALWAYS start watchers + poller — even if init failed, the poller will pick up new events
  // and the reconciler will backfill existing positions into the in-memory map
  startWatching();

  // Start reconciler: interval derives from block time (at least every 4 blocks, min 10s)
  if (getPrisma()) {
    const defaultReconcileMs = Math.max(config.blockTimeMs * 4, 10_000);
    const reconcileIntervalMs = Number(process.env.RECONCILE_INTERVAL_MS || defaultReconcileMs);
    setInterval(reconcile, reconcileIntervalMs);
    reconcile(); // run immediately on startup
    logger.info("Main", `Position reconciler scheduled (every ${reconcileIntervalMs / 1000}s, block time ${config.blockTimeMs / 1000}s)`);
  }

  // Read current on-chain prices into cache before starting the fetcher.
  // On first deploy, feeds will revert — allSettled handles gracefully.
  await initOnChainState();

  // Fee accrual runs on its own block-time timer — independent of price pushes.
  // Cumulative accumulators are continuous; frequent calls keep rates accurate
  // as OI changes from position opens/closes.
  setInterval(() => {
    maybeTriggerAccrual().catch((err) =>
      logger.warn("Main", `Fee accrual error: ${(err as Error).message}`)
    );
  }, config.blockTimeMs);

  logger.info("Main", "Oracle service running. Press Ctrl+C to stop.");

  // Start price fetcher with processing pipeline.
  // startFetcher returns Promise<never> (runs forever) — fire-and-forget.
  startFetcher(async (ticks: PriceTick[]) => {
    // 1. Store in memory/DB
    storePriceTicks(ticks);

    // 2. Broadcast to WebSocket clients
    broadcastPrices(ticks);

    // 2b. For CLOSED markets (NOT paused), broadcast VAMM prices + inject synthetic ticks
    // During PAUSED state, no VAMM prices — we're still in market hours, just waiting for data
    if (config.vammAddress) {
      try {
        const vammClient = createPublicClient({
          chain: getChain(),
          transport: http(config.rpcUrl),
        });
        const vammPriceUpdates: { feedId: number; price: string; timestamp: number }[] = [];
        for (const feedId of config.feedIds) {
          // Only inject VAMM prices when market is CLOSED (P2P active), not PAUSED
          if (getMarketState(feedId) !== "CLOSED") continue;
          const vammState = await vammClient.readContract({
            address: config.vammAddress as Hex,
            abi: VAMMABI,
            functionName: "vamms",
            args: [feedId],
          }) as [bigint, bigint, bigint, bigint, boolean];
          if (!vammState[4]) continue; // not active
          const vammPrice = await vammClient.readContract({
            address: config.vammAddress as Hex,
            abi: VAMMABI,
            functionName: "getVAMMPrice",
            args: [feedId],
          }) as bigint;
          vammPriceUpdates.push({ feedId, price: vammPrice.toString(), timestamp: Date.now() });
          // Inject as synthetic tick for candle building — tagged as virtual VAMM price
          storePriceTicks([{
            feedId,
            price: vammPrice,
            rawPrice: vammPrice,
            timestamp: Date.now(),
            fresh: false,
            source: "vamm",
          }]);
        }
        if (vammPriceUpdates.length > 0) {
          broadcastVammPrices(vammPriceUpdates);
        }
      } catch {
        // VAMM read failed — skip this tick
      }
    }

    // 3. Push to chain first — ensures on-chain Oracle has prices before settlement
    if (config.oracleAddress) {
      await pushPrices(ticks);
    }

    // 4. Detect market state changes (after prices are on-chain)
    const stateChanges = detectMarketStateChanges(ticks);
    if (stateChanges.length > 0) {
      for (const sc of stateChanges) {
        const feedName = config.feedNames[sc.feedId] || `Feed ${sc.feedId}`;
        logger.info("Pipeline", `*** MARKET STATE CHANGE: ${feedName} → ${sc.state} (${sc.reason ?? ""}) ***`);
      }

      // Broadcast ALL state changes (OPEN, PAUSED, CLOSED) to WS clients
      broadcastMarketState(stateChanges);

      // Log transitions to DB — skip OPEN→PAUSED→OPEN recovery (not a real market opening)
      for (const sc of stateChanges) {
        if (sc.state === "OPEN" && sc.previousState === "OPEN") continue;
        const tick = ticks.find(t => t.feedId === sc.feedId);
        logMarketState(sc.feedId, sc.state.toLowerCase(), tick?.price.toString() ?? null, new Date(sc.timestamp), sc.reason);
      }

      // On-chain settlement: skip PAUSED + skip OPEN→PAUSED→OPEN recovery
      const onChainChanges = stateChanges.filter(sc => {
        if (sc.state === "PAUSED") return false;
        if (sc.state === "OPEN" && sc.previousState === "OPEN") return false;
        return true;
      });
      if (onChainChanges.length > 0) {
        logger.info("Pipeline", `Triggering settlement for ${onChainChanges.length} on-chain state change(s) (${stateChanges.length - onChainChanges.length} PAUSED skipped)`);
        await handleMarketOpenSettlement(onChainChanges);
        logger.info("Pipeline", "Settlement handler returned");
      }
    }
  }).catch((err) =>
    logger.error("Main", `Fetcher crashed: ${(err as Error).message}`)
  );
}

main().catch((err) => {
  logger.error("Main", `Fatal error: ${err.message}`);
  process.exit(1);
});

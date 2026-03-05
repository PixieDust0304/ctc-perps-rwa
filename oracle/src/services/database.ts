import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type { PriceTick, CandleData } from "../types/index.js";

let prisma: PrismaClient | null = null;

/**
 * Initialize Prisma client if DATABASE_URL is configured.
 * Returns false if DB is unavailable — caller should fallback to in-memory.
 */
export async function initDatabase(): Promise<boolean> {
  if (!config.databaseUrl) {
    logger.info("DB", "DATABASE_URL not set — skipping Prisma init");
    return false;
  }

  try {
    prisma = new PrismaClient({
      datasourceUrl: config.databaseUrl,
    });
    await prisma.$connect();
    logger.info("DB", "Prisma connected to PostgreSQL");
    return true;
  } catch (err) {
    logger.warn("DB", `Prisma connection failed — falling back to in-memory: ${err}`);
    prisma = null;
    return false;
  }
}

export function getPrisma(): PrismaClient | null {
  return prisma;
}

/**
 * Persist price ticks to PostgreSQL (batch insert)
 */
export async function persistPriceTicks(ticks: PriceTick[]): Promise<void> {
  if (!prisma || ticks.length === 0) return;

  try {
    await prisma.priceTick.createMany({
      data: ticks.map((t) => ({
        feedId: t.feedId,
        price: t.price.toString(),
        fresh: t.fresh,
        timestamp: new Date(t.timestamp),
      })),
    });
  } catch (err) {
    logger.warn("DB", `Failed to persist price ticks: ${err}`);
  }
}

/**
 * Upsert candle data to PostgreSQL
 */
export async function persistCandle(candle: CandleData): Promise<void> {
  if (!prisma) return;

  try {
    await prisma.candle.upsert({
      where: {
        feedId_interval_timestamp: {
          feedId: candle.feedId,
          interval: candle.interval,
          timestamp: new Date(candle.timestamp),
        },
      },
      update: {
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      },
      create: {
        feedId: candle.feedId,
        interval: candle.interval,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        timestamp: new Date(candle.timestamp),
      },
    });
  } catch (err) {
    logger.warn("DB", `Failed to persist candle: ${err}`);
  }
}

/**
 * Query candles from PostgreSQL
 */
export async function queryCandles(
  feedId: number,
  interval: string,
  limit: number
): Promise<CandleData[]> {
  if (!prisma) return [];

  try {
    const rows = await prisma.candle.findMany({
      where: { feedId, interval },
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return rows.map((r) => ({
      feedId: r.feedId,
      interval: r.interval,
      open: r.open.toString(),
      high: r.high.toString(),
      low: r.low.toString(),
      close: r.close.toString(),
      volume: r.volume?.toString() ?? "0",
      timestamp: r.timestamp.getTime(),
    }));
  } catch (err) {
    logger.warn("DB", `Failed to query candles: ${err}`);
    return [];
  }
}

/**
 * Log a market state change
 */
export async function logMarketState(
  feedId: number,
  state: string,
  price: string | null,
  timestamp: Date
): Promise<void> {
  if (!prisma) return;

  try {
    await prisma.marketStateLog.create({
      data: {
        feedId,
        state,
        price: price ? BigInt(price).toString() : null,
        timestamp,
      },
    });
  } catch (err) {
    logger.warn("DB", `Failed to log market state: ${err}`);
  }
}

/**
 * Log a keeper event
 */
export async function logKeeperEvent(
  keeperType: string,
  feedId: number,
  action: string,
  positionId: string,
  txHash: string | null,
  status: string,
  errorMessage: string | null
): Promise<void> {
  if (!prisma) return;

  try {
    await prisma.keeperEvent.create({
      data: { keeperType, feedId, action, positionId, txHash, status, errorMessage },
    });
  } catch (err) {
    logger.warn("DB", `Failed to log keeper event: ${err}`);
  }
}

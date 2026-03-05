-- CTC-Perps PostgreSQL Schema (reference — Prisma manages migrations)

CREATE TABLE IF NOT EXISTS "PriceTick" (
    id BIGSERIAL PRIMARY KEY,
    "feedId" INTEGER NOT NULL,
    price DECIMAL(38, 18) NOT NULL,
    fresh BOOLEAN NOT NULL,
    "timestamp" TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pricetick_feed_ts ON "PriceTick" ("feedId", "timestamp");

CREATE TABLE IF NOT EXISTS "Candle" (
    id BIGSERIAL PRIMARY KEY,
    "feedId" INTEGER NOT NULL,
    interval VARCHAR(10) NOT NULL,
    open DECIMAL(38, 18) NOT NULL,
    high DECIMAL(38, 18) NOT NULL,
    low DECIMAL(38, 18) NOT NULL,
    close DECIMAL(38, 18) NOT NULL,
    volume DECIMAL(38, 18) DEFAULT 0,
    "timestamp" TIMESTAMP NOT NULL,
    UNIQUE ("feedId", interval, "timestamp")
);

CREATE TABLE IF NOT EXISTS "MarketStateLog" (
    id BIGSERIAL PRIMARY KEY,
    "feedId" INTEGER NOT NULL,
    state VARCHAR(20) NOT NULL,
    price DECIMAL(38, 18),
    "timestamp" TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "KeeperEvent" (
    id BIGSERIAL PRIMARY KEY,
    "keeperType" VARCHAR(50) NOT NULL,
    "feedId" INTEGER NOT NULL,
    action VARCHAR(50) NOT NULL,
    "positionId" VARCHAR(100) NOT NULL,
    "txHash" VARCHAR(100),
    status VARCHAR(20) NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP DEFAULT NOW()
);

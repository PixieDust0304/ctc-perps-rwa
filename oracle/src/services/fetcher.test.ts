import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config/index.js", () => ({
  config: {
    autonomUrl: "http://test-autonom",
    autonomApiKey: "testkey",
    feedIds: [2056, 2069],
    feedNames: { 2056: "Gold/XAU", 2069: "Silver/XAG" } as Record<number, string>,
    stalenessThresholdMs: 210_000,
    frozenTimestampThresholdMs: 30_000,
    fetchIntervalMs: 500,
  },
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("./priceStore.js", () => ({
  getLatestPrice: vi.fn().mockReturnValue(null),
}));

import { fetchPrices, _resetFetcherState } from "./fetcher.js";

function createMockResponse(overrides?: {
  timestamps?: number;
  perFeed?: { feed_id: number; price: number; timestamp: number }[];
  errors?: { feed_id: number; code: string; message: string }[];
}) {
  const ts = overrides?.timestamps ?? Date.now();
  const prices = overrides?.perFeed ?? [
    { feed_id: 2056, price: 30377000000000, expo: -10, timestamp: ts },
    { feed_id: 2069, price: 242000000000, expo: -10, timestamp: ts },
  ];
  return {
    prices,
    errors: overrides?.errors,
    signature: "0xdeadbeef",
    recovery_id: 0,
    served_at: Math.floor(ts / 1000),
    request: { fresh: true, prefer_cache: false, allow_stale_on_error: false, include_eth: false },
    kid: "test",
    version: 1,
  };
}

function mockFetchWith(response: ReturnType<typeof createMockResponse>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    })
  );
}

describe("fetcher", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    _resetFetcherState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fetches and converts prices to 18-decimal format", async () => {
    const now = Date.now();
    mockFetchWith(createMockResponse({ timestamps: now }));

    const ticks = await fetchPrices();

    expect(ticks.length).toBe(2);

    // Gold: raw 30377000000000 * 10^8 = 3037700000000000000000 (3037.7e18)
    expect(ticks[0].feedId).toBe(2056);
    expect(ticks[0].rawPrice).toBe(30377000000000n);
    expect(ticks[0].price).toBe(30377000000000n * 10n ** 8n);
    expect(ticks[0].fresh).toBe(true);
    expect(ticks[0].timestamp).toBe(now);

    // Silver: raw 242000000000 * 10^8 = 24200000000000000000 (24.2e18)
    expect(ticks[1].feedId).toBe(2069);
    expect(ticks[1].price).toBe(242000000000n * 10n ** 8n);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" })
    );

    await expect(fetchPrices()).rejects.toThrow("Autonom API error: 500 Server Error");
  });

  it("propagates network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network timeout")));

    await expect(fetchPrices()).rejects.toThrow("Network timeout");
  });

  it("marks stale when timestamp age exceeds staleness threshold", async () => {
    const oldTimestamp = Date.now() - 300_000; // 300s ago, past 210s threshold
    mockFetchWith(createMockResponse({ timestamps: oldTimestamp }));

    const ticks = await fetchPrices();
    expect(ticks.every((t) => t.fresh === false)).toBe(true);
  });

  it("detects frozen timestamps after threshold and marks fresh=false", async () => {
    vi.useFakeTimers();
    const baseTime = 1700000000000;
    const frozenTimestamp = baseTime;

    // First fetch: timestamp is current, should be fresh
    vi.setSystemTime(baseTime);
    mockFetchWith(createMockResponse({ timestamps: frozenTimestamp }));
    let ticks = await fetchPrices();
    expect(ticks[0].fresh).toBe(true);
    expect(ticks[1].fresh).toBe(true);

    // Advance time past frozen threshold (30s) but well within staleness (210s)
    vi.setSystemTime(baseTime + 31_000);
    mockFetchWith(createMockResponse({ timestamps: frozenTimestamp }));
    ticks = await fetchPrices();
    expect(ticks[0].fresh).toBe(false); // FROZEN — timestamp hasn't advanced in 31s
    expect(ticks[1].fresh).toBe(false);
  });

  it("resets frozen detection when upstream timestamp advances", async () => {
    vi.useFakeTimers();
    const baseTime = 1700000000000;

    // First fetch at T+0
    vi.setSystemTime(baseTime);
    mockFetchWith(createMockResponse({ timestamps: baseTime }));
    await fetchPrices();

    // T+31s: same timestamp → frozen
    vi.setSystemTime(baseTime + 31_000);
    mockFetchWith(createMockResponse({ timestamps: baseTime }));
    let ticks = await fetchPrices();
    expect(ticks[0].fresh).toBe(false);

    // T+31s: new advancing timestamp → unfrozen
    const advancedTimestamp = baseTime + 31_000;
    mockFetchWith(createMockResponse({ timestamps: advancedTimestamp }));
    ticks = await fetchPrices();
    expect(ticks[0].fresh).toBe(true); // Reset — timestamp advanced
    expect(ticks[1].fresh).toBe(true);
  });

  it("detects frozen per-feed independently", async () => {
    vi.useFakeTimers();
    const baseTime = 1700000000000;

    // First fetch: both feeds current
    vi.setSystemTime(baseTime);
    mockFetchWith(
      createMockResponse({
        perFeed: [
          { feed_id: 2056, price: 30377000000000, timestamp: baseTime },
          { feed_id: 2069, price: 242000000000, timestamp: baseTime },
        ],
      })
    );
    await fetchPrices();

    // T+31s: Gold frozen, Silver advancing
    vi.setSystemTime(baseTime + 31_000);
    mockFetchWith(
      createMockResponse({
        perFeed: [
          { feed_id: 2056, price: 30377000000000, timestamp: baseTime }, // frozen
          { feed_id: 2069, price: 242000000000, timestamp: baseTime + 31_000 }, // advancing
        ],
      })
    );
    const ticks = await fetchPrices();
    const gold = ticks.find((t) => t.feedId === 2056)!;
    const silver = ticks.find((t) => t.feedId === 2069)!;
    expect(gold.fresh).toBe(false); // Gold frozen
    expect(silver.fresh).toBe(true); // Silver still advancing
  });
});

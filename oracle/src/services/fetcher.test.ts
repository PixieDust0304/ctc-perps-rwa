import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPrices } from "./fetcher.js";

// Mock response matching Autonom API format
const mockAutonomResponse = {
  prices: [
    { feed_id: 2056, price: 30377000000000, expo: -10, timestamp: 1700000000000 },
    { feed_id: 2069, price: 242000000000, expo: -10, timestamp: 1700000000000 },
  ],
  signature: "0xdeadbeef",
  recovery_id: 0,
  served_at: 1700000000,
  request: { fresh: true, prefer_cache: false, allow_stale_on_error: false, include_eth: false },
  kid: "test",
  version: 1,
};

describe("fetcher", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and converts prices to 18-decimal format", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAutonomResponse),
    });
    vi.stubGlobal("fetch", mockFetch);

    const ticks = await fetchPrices();

    expect(ticks.length).toBe(2);

    // Gold: raw 30377000000000 * 10^8 = 3037700000000000000000 (3037.7e18)
    expect(ticks[0].feedId).toBe(2056);
    expect(ticks[0].rawPrice).toBe(30377000000000n);
    expect(ticks[0].price).toBe(30377000000000n * 10n ** 8n);
    expect(ticks[0].fresh).toBe(true);
    expect(ticks[0].timestamp).toBe(1700000000000);

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

  it("sets fresh flag from response", async () => {
    const staleResponse = {
      ...mockAutonomResponse,
      request: { ...mockAutonomResponse.request, fresh: false },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(staleResponse) })
    );

    const ticks = await fetchPrices();
    expect(ticks.every((t) => t.fresh === false)).toBe(true);
  });
});

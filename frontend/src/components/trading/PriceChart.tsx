"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  type LineData,
  type Time,
} from "lightweight-charts";

const INTERVALS = [
  { label: "1m", interval: "1m", lookbackMs: 60_000 },
  { label: "5m", interval: "5m", lookbackMs: 300_000 },
  { label: "10m", interval: "10m", lookbackMs: 600_000 },
  { label: "30m", interval: "30m", lookbackMs: 1_800_000 },
  { label: "1h", interval: "1h", lookbackMs: 3_600_000 },
  { label: "6h", interval: "6h", lookbackMs: 21_600_000 },
  { label: "12h", interval: "12h", lookbackMs: 43_200_000 },
  { label: "24h", interval: "1d", lookbackMs: 86_400_000 },
  { label: "7d", interval: "1d", lookbackMs: 604_800_000 },
  { label: "1M", interval: "1d", lookbackMs: 2_592_000_000 },
  { label: "6M", interval: "1d", lookbackMs: 15_552_000_000 },
  { label: "1Y", interval: "1d", lookbackMs: 31_536_000_000 },
] as const;

interface PriceChartProps {
  feedId: number;
  feedName: string;
  currentPrice: number;
  apiUrl?: string;
}

export function PriceChart({
  feedId,
  feedName,
  currentPrice,
  apiUrl = "http://localhost:3001",
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const feedIdRef = useRef(feedId);

  const [selectedIdx, setSelectedIdx] = useState(0); // default 1m
  const [movement, setMovement] = useState<{ changePercent: number } | null>(null);

  const [priceDirection, setPriceDirection] = useState<"up" | "down" | "flat">("flat");
  const [flash, setFlash] = useState(false);
  const [fading, setFading] = useState(false);
  const prevDisplayPrice = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = INTERVALS[selectedIdx];

  // Track price direction + trigger flash with 10s persist then fade
  useEffect(() => {
    if (currentPrice <= 0) return;
    const prev = prevDisplayPrice.current;
    prevDisplayPrice.current = currentPrice;
    if (prev > 0 && currentPrice !== prev) {
      setPriceDirection(currentPrice > prev ? "up" : "down");
      setFlash(true);
      setFading(false);

      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

      flashTimerRef.current = setTimeout(() => {
        setFading(true);
        fadeTimerRef.current = setTimeout(() => {
          setFlash(false);
          setFading(false);
        }, 1000);
      }, 10000);
    }
  }, [currentPrice]);

  // Reset on feed switch
  useEffect(() => {
    setPriceDirection("flat");
    setFlash(false);
    setFading(false);
    setMovement(null);
    prevDisplayPrice.current = 0;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  }, [feedId]);

  // Fetch movement data
  // Use at least 5min lookback so short intervals (15s, 1m) still have enough ticks
  const movementLookback = Math.max(selected.lookbackMs, 300_000);
  const fetchMovement = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiUrl}/api/movement/${feedId}?lookback=${movementLookback}`
      );
      if (!res.ok) { setMovement(null); return; }
      const data = await res.json();
      if (feedIdRef.current === feedId) setMovement(data);
    } catch {
      setMovement(null);
    }
  }, [feedId, movementLookback, apiUrl]);

  useEffect(() => {
    fetchMovement();
    const id = setInterval(fetchMovement, 5000);
    return () => clearInterval(id);
  }, [fetchMovement]);

  // Fetch candles and build chart when feed or interval changes
  useEffect(() => {
    if (!containerRef.current) return;
    feedIdRef.current = feedId;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#121212" },
        textColor: "#555555",
      },
      grid: {
        vertLines: { color: "rgba(255, 212, 0, 0.02)" },
        horzLines: { color: "rgba(255, 212, 0, 0.02)" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "rgba(255, 255, 255, 0.06)", autoScale: true },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.06)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
      },
      width: containerRef.current.clientWidth,
      height: 500,
    });

    const series = chart.addLineSeries({
      color: "#FFD400",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "#FFD400",
      priceLineWidth: 1,
      priceLineStyle: 2,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    const fetchCandles = async () => {
      try {
        const limit = selected.lookbackMs <= 300_000 ? 200 : 500;
        const res = await fetch(
          `${apiUrl}/api/candles?feedId=${feedId}&interval=${selected.interval}&limit=${limit}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (feedIdRef.current !== feedId) return;

        if (Array.isArray(data) && data.length > 0) {
          const cutoff = Date.now() - selected.lookbackMs;
          const filtered = data.filter(
            (c: { timestamp: number }) => c.timestamp >= cutoff
          );
          const sorted = (filtered.length > 0 ? filtered : data).sort(
            (a: { timestamp: number }, b: { timestamp: number }) =>
              a.timestamp - b.timestamp
          );

          const points: LineData<Time>[] = sorted.map(
            (c: { timestamp: number; close: string }) => ({
              time: (c.timestamp / 1000) as Time,
              value: Number(c.close) / 1e18,
            })
          );

          seriesRef.current?.setData(points);
        }
      } catch {
        // Oracle API not available
      }
    };

    fetchCandles();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [feedId, selectedIdx, apiUrl, selected.interval, selected.lookbackMs]);

  // Live price tick update
  useEffect(() => {
    if (!seriesRef.current || currentPrice <= 0) return;
    if (feedIdRef.current !== feedId) return;

    const intervalMs = 60000;
    const now = Math.floor(Date.now() / intervalMs) * (intervalMs / 1000);

    seriesRef.current.update({
      time: now as Time,
      value: currentPrice,
    });
  }, [currentPrice, feedId, selected.interval]);

  const priceColor = flash
    ? priceDirection === "up"
      ? fading ? "text-white" : "text-yellow-400"
      : priceDirection === "down"
        ? fading ? "text-white" : "text-red-400"
        : "text-white"
    : "text-white";

  const flashBg = flash
    ? priceDirection === "up"
      ? fading ? "bg-transparent" : "bg-yellow-500/15"
      : priceDirection === "down"
        ? fading ? "bg-transparent" : "bg-red-500/15"
        : ""
    : "";

  const movementColor = movement
    ? movement.changePercent > 0
      ? "text-yellow-400"
      : movement.changePercent < 0
        ? "text-red-400"
        : "text-gray-400"
    : "text-gray-500";

  const movementSign = movement && movement.changePercent > 0 ? "+" : "";

  return (
    <div style={{ background: "#121212" }}>
      {/* Header: feed name, price, movement + interval selector */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-3">
          <span className="font-pixel text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dim-text)" }}>{feedName} / USD</span>
          <span
            className={`text-xl font-body font-bold px-2 py-0.5 rounded-lg transition-all duration-1000 ${priceColor} ${flashBg}`}
          >
            ${currentPrice > 0 ? currentPrice.toFixed(2) : "---"}
            {priceDirection === "up" && <span className="ml-1 text-xs" style={{ color: "var(--profit-green)" }}>▲</span>}
            {priceDirection === "down" && <span className="ml-1 text-xs" style={{ color: "var(--trade-red)" }}>▼</span>}
          </span>
          {movement && (
            <span className={`text-xs font-body font-semibold ${movementColor}`}>
              {movementSign}{movement.changePercent.toFixed(2)}%
              <span className="ml-1 text-[10px]" style={{ color: "var(--dim-text)" }}>{movementLookback > selected.lookbackMs ? "5m" : selected.label}</span>
            </span>
          )}
        </div>

        {/* Tetris-style interval selector */}
        <div className="flex gap-0.5 flex-wrap justify-end">
          {INTERVALS.map((iv, idx) => (
            <button
              key={iv.label}
              onClick={() => setSelectedIdx(idx)}
              className={`px-2 py-1 rounded-md text-[10px] font-pixel font-bold uppercase tracking-wide transition-all ${idx === selectedIdx
                ? "text-black"
                : "hover:bg-white/[0.04]"
                }`}
              style={idx === selectedIdx ? {
                background: "linear-gradient(135deg, var(--pixel-yellow), var(--arcade-orange))",
                boxShadow: "0 2px 8px var(--pixel-yellow-glow)",
              } : { color: "var(--dim-text)" }}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="w-full" />
    </div>
  );
}

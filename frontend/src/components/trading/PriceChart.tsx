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
  { label: "15s", interval: "15s", lookbackMs: 15_000 },
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

  const [selectedIdx, setSelectedIdx] = useState(1); // default 1m
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
        background: { type: ColorType.Solid, color: "#111827" },
        textColor: "#9CA3AF",
      },
      grid: {
        vertLines: { color: "#1F2937" },
        horzLines: { color: "#1F2937" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#374151", autoScale: true },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: selected.interval === "15s",
      },
      width: containerRef.current.clientWidth,
      height: 400,
    });

    const series = chart.addLineSeries({
      color: "#22C55E",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "#22C55E",
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

    const intervalMs = selected.interval === "15s" ? 15000 : 60000;
    const now = Math.floor(Date.now() / intervalMs) * (intervalMs / 1000);

    seriesRef.current.update({
      time: now as Time,
      value: currentPrice,
    });
  }, [currentPrice, feedId, selected.interval]);

  const priceColor = flash
    ? priceDirection === "up"
      ? fading ? "text-white" : "text-green-400"
      : priceDirection === "down"
        ? fading ? "text-white" : "text-red-400"
        : "text-white"
    : "text-white";

  const flashBg = flash
    ? priceDirection === "up"
      ? fading ? "bg-transparent" : "bg-green-500/20"
      : priceDirection === "down"
        ? fading ? "bg-transparent" : "bg-red-500/20"
        : ""
    : "";

  const movementColor = movement
    ? movement.changePercent > 0
      ? "text-green-400"
      : movement.changePercent < 0
        ? "text-red-400"
        : "text-gray-400"
    : "text-gray-500";

  const movementSign = movement && movement.changePercent > 0 ? "+" : "";

  return (
    <div className="relative">
      {/* Header: feed name, price, movement */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-3">
        <span className="text-gray-400 text-sm">{feedName} / USD</span>
        <span
          className={`text-lg font-mono px-2 py-0.5 rounded transition-all duration-1000 ${priceColor} ${flashBg}`}
        >
          ${currentPrice > 0 ? currentPrice.toFixed(2) : "---"}
          {priceDirection === "up" && <span className="ml-1 text-xs">&#9650;</span>}
          {priceDirection === "down" && <span className="ml-1 text-xs">&#9660;</span>}
        </span>
        {movement && (
          <span className={`text-sm font-mono ${movementColor}`}>
            {movementSign}{movement.changePercent.toFixed(2)}%
            <span className="text-gray-500 ml-1 text-xs">{movementLookback > selected.lookbackMs ? "5m" : selected.label}</span>
          </span>
        )}
      </div>

      {/* Interval selector */}
      <div className="absolute top-2 right-2 z-10 flex gap-0.5 flex-wrap justify-end">
        {INTERVALS.map((iv, idx) => (
          <button
            key={iv.label}
            onClick={() => setSelectedIdx(idx)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              idx === selectedIdx
                ? "bg-blue-600 text-white"
                : "bg-gray-800/80 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            }`}
          >
            {iv.label}
          </button>
        ))}
      </div>

      <div ref={containerRef} className="w-full" />
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  type LineData,
  type Time,
  type SeriesMarker,
} from "lightweight-charts";

const INTERVALS = [
  { label: "1m", interval: "1m", lookbackMs: 3_600_000 },
  { label: "5m", interval: "5m", lookbackMs: 7_200_000 },
  { label: "10m", interval: "10m", lookbackMs: 14_400_000 },
  { label: "30m", interval: "30m", lookbackMs: 43_200_000 },
  { label: "1h", interval: "1h", lookbackMs: 86_400_000 },
  { label: "6h", interval: "6h", lookbackMs: 604_800_000 },
  { label: "12h", interval: "12h", lookbackMs: 2_592_000_000 },
  { label: "24h", interval: "1d", lookbackMs: 7_776_000_000 },
  { label: "7d", interval: "1d", lookbackMs: 15_552_000_000 },
  { label: "1M", interval: "1d", lookbackMs: 31_536_000_000 },
  { label: "6M", interval: "1d", lookbackMs: 31_536_000_000 },
  { label: "1Y", interval: "1d", lookbackMs: 31_536_000_000 },
] as const;

interface PriceChartProps {
  feedId: number;
  feedName: string;
  currentPrice: number;
  apiUrl?: string;
  isVammPrice?: boolean;
}

export function PriceChart({
  feedId,
  feedName,
  currentPrice,
  apiUrl = "http://localhost:3001",
  isVammPrice = false,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const feedIdRef = useRef(feedId);
  const marketStatesRef = useRef<{ state: string; timestamp: number }[]>([]);

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

    const drawOverlayLines = () => {
      const canvas = overlayRef.current;
      const ch = chartRef.current;
      if (!canvas || !ch) return;
      const ts = ch.timeScale();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      canvas.width = rect.width;
      canvas.height = rect.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const ms of marketStatesRef.current) {
        const timeSec = Math.floor(ms.timestamp / 1000) as Time;
        const x = ts.timeToCoordinate(timeSec);
        if (x === null || x < 0 || x > canvas.width) continue;

        const isClosed = ms.state === "closed";
        const purple = isClosed ? "rgba(168, 85, 247, 0.6)" : "rgba(139, 92, 246, 0.5)";
        const glowPurple = isClosed ? "rgba(168, 85, 247, 0.15)" : "rgba(139, 92, 246, 0.1)";

        // Glow
        ctx.save();
        ctx.shadowColor = purple;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = purple;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
        ctx.restore();

        // Wider glow band
        const grad = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.5, glowPurple);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(x - 8, 0, 16, canvas.height);

        // Label near top
        const label = isClosed ? "Market Closed" : "Market Open";
        ctx.save();
        ctx.font = "bold 10px monospace";
        ctx.fillStyle = "#c084fc";
        ctx.shadowColor = "rgba(168, 85, 247, 0.8)";
        ctx.shadowBlur = 6;
        ctx.textAlign = "center";
        ctx.fillText(label, x, 16);
        ctx.restore();
      }
    };

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
      // Redraw overlay after resize settles
      requestAnimationFrame(drawOverlayLines);
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

    const fetchMarketStates = async () => {
      try {
        const res = await fetch(
          `${apiUrl}/api/market-states?feedId=${feedId}&limit=200`
        );
        if (!res.ok) return;
        const data: { state: string; timestamp: number }[] = await res.json();
        if (feedIdRef.current !== feedId) return;

        const cutoff = Date.now() - selected.lookbackMs;
        marketStatesRef.current = data
          .filter((s) => s.timestamp >= cutoff)
          .sort((a, b) => a.timestamp - b.timestamp);

        // Set markers on the series
        if (seriesRef.current && marketStatesRef.current.length > 0) {
          const markers: SeriesMarker<Time>[] = marketStatesRef.current.map((s) => ({
            time: (Math.floor(s.timestamp / 1000)) as Time,
            position: "aboveBar" as const,
            color: s.state === "closed" ? "#a855f7" : "#8b5cf6",
            shape: "circle" as const,
            text: s.state === "closed" ? "Closed" : "Open",
          }));
          seriesRef.current.setMarkers(markers);
        }

        drawOverlayLines();
      } catch {
        // Market state API not available
      }
    };

    fetchCandles().then(fetchMarketStates);

    // Redraw overlay on scroll/zoom
    chart.timeScale().subscribeVisibleTimeRangeChange(drawOverlayLines);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(drawOverlayLines);
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
          {isVammPrice && (
            <span className="text-xs font-pixel font-bold px-2.5 py-1 rounded-md animate-pulse" style={{ color: "#e9d5ff", background: "linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(139, 92, 246, 0.25))", border: "1px solid rgba(168, 85, 247, 0.5)", boxShadow: "0 0 12px rgba(168, 85, 247, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)" }}>
              VAMM PRICE
            </span>
          )}
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

      <div className="relative w-full">
        <div ref={containerRef} className="w-full" />
        <canvas
          ref={overlayRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{ zIndex: 10 }}
        />
      </div>
    </div>
  );
}

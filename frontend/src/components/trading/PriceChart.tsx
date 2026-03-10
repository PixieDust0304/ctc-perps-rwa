"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  type LineData,
  type Time,
} from "lightweight-charts";

// How many candles to fetch on initial load per interval.
// Target: fill ~150 visible candle slots + buffer for scrolling.
const INITIAL_CANDLE_COUNT = 300;
// How many candles to fetch per lazy-load page
const LAZY_LOAD_PAGE = 500;

const INTERVALS = [
  { label: "1m", interval: "1m", movementMs: 60_000 },
  { label: "5m", interval: "5m", movementMs: 300_000 },
  { label: "10m", interval: "10m", movementMs: 600_000 },
  { label: "30m", interval: "30m", movementMs: 1_800_000 },
  { label: "1h", interval: "1h", movementMs: 3_600_000 },
  { label: "6h", interval: "6h", movementMs: 21_600_000 },
  { label: "12h", interval: "12h", movementMs: 43_200_000 },
  { label: "24h", interval: "1d", movementMs: 86_400_000 },
  { label: "7d", interval: "1d", movementMs: 604_800_000 },
  { label: "1M", interval: "1d", movementMs: 2_592_000_000 },
  { label: "6M", interval: "1d", movementMs: 15_552_000_000 },
  { label: "1Y", interval: "1d", movementMs: 31_536_000_000 },
] as const;

interface PriceChartProps {
  feedId: number;
  feedName: string;
  currentPrice: number;
  apiUrl?: string;
  isVammPrice?: boolean;
}

/** Snap a ms timestamp to the nearest candle time bucket (in seconds) from the data */
function snapToNearestCandle(timestampMs: number, candleTimes: number[]): number {
  const sec = Math.floor(timestampMs / 1000);
  if (candleTimes.length === 0) return sec;
  let best = candleTimes[0];
  let bestDist = Math.abs(sec - best);
  for (const t of candleTimes) {
    const dist = Math.abs(sec - t);
    if (dist < bestDist) {
      best = t;
      bestDist = dist;
    }
  }
  return best;
}

export function PriceChart({
  feedId,
  feedName,
  currentPrice,
  apiUrl = process.env.NEXT_PUBLIC_ORACLE_API_URL || "http://localhost:3001",
  isVammPrice = false,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const feedIdRef = useRef(feedId);
  // Raw (unfiltered) market states from API — filtered dynamically in drawOverlayLines
  // based on current candleTimesRef so lazy-loaded candles automatically reveal older markers
  const rawMarketStatesRef = useRef<{ state: string; timestamp: number }[]>([]);
  const candleTimesRef = useRef<number[]>([]);
  const startPriceRef = useRef<number>(0);

  // Lazy loading state
  const allPointsRef = useRef<LineData<Time>[]>([]);
  const earliestTimestampRef = useRef<number>(0); // earliest candle ms timestamp loaded
  const isLoadingMoreRef = useRef(false);
  const hasMoreDataRef = useRef(true);

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

  // Reset on feed or interval switch
  useEffect(() => {
    setPriceDirection("flat");
    setFlash(false);
    setFading(false);
    setMovement(null);
    prevDisplayPrice.current = 0;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  }, [feedId, selectedIdx]);

  // Movement is computed from visible candle data (set inside fetchCandles)

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

    // Find the chart's internal content pane (the td that holds the plot canvas)
    // lightweight-charts v4 DOM: container > div(relative) > table > tr > td.chart-pane
    // The chart pane td contains the actual plot canvases.
    // We find it by looking for the canvas elements inside the chart container.
    let chartPane: Element | null = null;
    const allCanvases = containerRef.current.querySelectorAll("canvas");
    for (const c of allCanvases) {
      // The main plot canvas is typically the largest one
      if (c.clientHeight > 400) {
        chartPane = c.parentElement;
        break;
      }
    }
    if (!chartPane) {
      // Fallback: use the first table cell or first child
      chartPane = containerRef.current.querySelector("td") || containerRef.current.firstElementChild;
    }

    if (chartPane) {
      const el = chartPane as HTMLElement;
      // Ensure the parent is positioned for absolute children
      if (getComputedStyle(el).position === "static") {
        el.style.position = "relative";
      }
      const canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "10";
      el.appendChild(canvas);
      overlayCanvasRef.current = canvas;
    }

    const drawOverlayLines = () => {
      const canvas = overlayCanvasRef.current;
      const ch = chartRef.current;
      if (!canvas || !ch) return;
      const ts = ch.timeScale();

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Filter market states to the current candle range (dynamic — updates as lazy load extends range)
      const cTimes = candleTimesRef.current;
      const firstCandleSec = cTimes[0] ?? 0;
      const lastCandleSec = cTimes[cTimes.length - 1] ?? 0;
      let visibleStates = rawMarketStatesRef.current.filter(
        (s) => {
          // Only draw markers for open/closed transitions, not paused
          if (s.state === "paused") return false;
          const sSec = s.timestamp / 1000;
          return sSec >= firstCandleSec && sSec <= lastCandleSec;
        }
      );
      // If no states in range, show the most recent one (pins to left edge via snap)
      if (visibleStates.length === 0 && rawMarketStatesRef.current.length > 0) {
        visibleStates = [rawMarketStatesRef.current[rawMarketStatesRef.current.length - 1]];
      }

      for (const ms of visibleStates) {
        const snapped = snapToNearestCandle(ms.timestamp, cTimes);
        const x = ts.timeToCoordinate(snapped as Time);
        if (x === null || x < 0 || x > w) continue;

        const isClosed = ms.state === "closed";
        const purple = isClosed ? "rgba(168, 85, 247, 0.85)" : "rgba(139, 92, 246, 0.75)";
        const glowPurple = isClosed ? "rgba(168, 85, 247, 0.22)" : "rgba(139, 92, 246, 0.16)";

        // Wide glow band
        const grad = ctx.createLinearGradient(x - 20, 0, x + 20, 0);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.3, glowPurple);
        grad.addColorStop(0.5, isClosed ? "rgba(168, 85, 247, 0.3)" : "rgba(139, 92, 246, 0.22)");
        grad.addColorStop(0.7, glowPurple);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(x - 20, 0, 40, h);

        // Vertical line — triple stroke for glow
        ctx.save();
        ctx.shadowColor = purple;
        ctx.shadowBlur = 24;
        ctx.strokeStyle = purple;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.stroke();
        ctx.stroke();
        ctx.restore();

        // Label pill
        const label = isClosed ? "Market Closed" : "Market Open";
        ctx.save();
        ctx.font = "bold 12px monospace";
        const textW = ctx.measureText(label).width;
        const pillX = x - textW / 2 - 10;
        const pillY = 6;
        const pillW = textW + 20;
        const pillH = 22;

        ctx.fillStyle = isClosed ? "rgba(88, 28, 135, 0.85)" : "rgba(67, 56, 202, 0.85)";
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 4);
        ctx.fill();

        ctx.strokeStyle = isClosed ? "rgba(168, 85, 247, 0.6)" : "rgba(139, 92, 246, 0.5)";
        ctx.lineWidth = 1;
        ctx.shadowColor = purple;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 4);
        ctx.stroke();

        ctx.fillStyle = "#e9d5ff";
        ctx.shadowColor = "rgba(168, 85, 247, 0.8)";
        ctx.shadowBlur = 4;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, pillY + pillH / 2);
        ctx.restore();
      }
    };

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    // Use subscribeCrosshairMove for sync redraws — fires on every chart interaction
    chart.subscribeCrosshairMove(drawOverlayLines);
    // Also redraw on visible range changes (zoom, scroll without crosshair)
    chart.timeScale().subscribeVisibleTimeRangeChange(drawOverlayLines);

    // Reset lazy-load state on interval/feed change
    allPointsRef.current = [];
    earliestTimestampRef.current = 0;
    isLoadingMoreRef.current = false;
    hasMoreDataRef.current = true;

    const applyPointsToChart = (points: LineData<Time>[]) => {
      if (!seriesRef.current || !chartRef.current) return;

      // Store candle times for snapping market state markers
      candleTimesRef.current = points.map(p => p.time as number);

      seriesRef.current.setData(points);

      // Set visible range to show the last ~150 candles (fills the viewport)
      // instead of fitContent() which stretches sparse data across the whole view
      const totalBars = points.length;
      const visibleBars = 150;
      if (totalBars > visibleBars) {
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: totalBars - visibleBars - 5,
          to: totalBars + 5,
        });
      } else {
        chartRef.current.timeScale().fitContent();
      }
    };

    const computeMovement = (points: LineData<Time>[]) => {
      if (points.length >= 2) {
        const latestPrice = points[points.length - 1].value;
        const targetTimeSec = Math.floor((Date.now() - selected.movementMs) / 1000);
        const oldestTimeSec = points[0].time as number;
        let compPrice: number;
        if (targetTimeSec <= oldestTimeSec) {
          compPrice = points[0].value;
        } else {
          compPrice = points[0].value;
          let bestDist = Math.abs((points[0].time as number) - targetTimeSec);
          for (const p of points) {
            const dist = Math.abs((p.time as number) - targetTimeSec);
            if (dist < bestDist) {
              bestDist = dist;
              compPrice = p.value;
            }
          }
        }
        startPriceRef.current = compPrice;
        const changePercent = compPrice > 0 ? ((latestPrice - compPrice) / compPrice) * 100 : 0;
        if (feedIdRef.current === feedId) setMovement({ changePercent });
      } else {
        startPriceRef.current = 0;
        if (feedIdRef.current === feedId) setMovement(null);
      }
    };

    const fetchCandles = async () => {
      try {
        const res = await fetch(
          `${apiUrl}/api/candles?feedId=${feedId}&interval=${selected.interval}&limit=${INITIAL_CANDLE_COUNT}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (feedIdRef.current !== feedId) return;

        if (Array.isArray(data) && data.length > 0) {
          const sorted = [...data].sort(
            (a: { timestamp: number }, b: { timestamp: number }) =>
              a.timestamp - b.timestamp
          );

          const points: LineData<Time>[] = sorted.map(
            (c: { timestamp: number; close: string }) => ({
              time: (c.timestamp / 1000) as Time,
              value: Number(c.close) / 1e18,
            })
          );

          allPointsRef.current = points;
          earliestTimestampRef.current = sorted[0].timestamp;
          hasMoreDataRef.current = data.length >= INITIAL_CANDLE_COUNT;

          applyPointsToChart(points);
          computeMovement(points);
        }
      } catch {
        // Oracle API not available
      }
    };

    // Lazy load: fetch older candles when user scrolls back
    const loadOlderCandles = async () => {
      if (isLoadingMoreRef.current || !hasMoreDataRef.current) return;
      if (!earliestTimestampRef.current) return;
      isLoadingMoreRef.current = true;

      try {
        const res = await fetch(
          `${apiUrl}/api/candles?feedId=${feedId}&interval=${selected.interval}&limit=${LAZY_LOAD_PAGE}&before=${earliestTimestampRef.current}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (feedIdRef.current !== feedId) return;

        if (Array.isArray(data) && data.length > 0) {
          const sorted = [...data].sort(
            (a: { timestamp: number }, b: { timestamp: number }) =>
              a.timestamp - b.timestamp
          );

          const olderPoints: LineData<Time>[] = sorted.map(
            (c: { timestamp: number; close: string }) => ({
              time: (c.timestamp / 1000) as Time,
              value: Number(c.close) / 1e18,
            })
          );

          earliestTimestampRef.current = sorted[0].timestamp;
          hasMoreDataRef.current = data.length >= LAZY_LOAD_PAGE;

          // Prepend older data and re-set the series
          // Deduplicate by time
          const existingTimes = new Set(allPointsRef.current.map(p => p.time));
          const newPoints = olderPoints.filter(p => !existingTimes.has(p.time));
          allPointsRef.current = [...newPoints, ...allPointsRef.current];

          // Preserve the current visible range so the view doesn't jump
          const currentRange = chartRef.current?.timeScale().getVisibleLogicalRange();
          seriesRef.current?.setData(allPointsRef.current);
          candleTimesRef.current = allPointsRef.current.map(p => p.time as number);

          if (currentRange) {
            // Shift range to account for prepended candles
            chartRef.current?.timeScale().setVisibleLogicalRange({
              from: currentRange.from + newPoints.length,
              to: currentRange.to + newPoints.length,
            });
          }
        } else {
          hasMoreDataRef.current = false;
        }
      } catch {
        // Failed to load more candles
      } finally {
        isLoadingMoreRef.current = false;
      }
    };

    // Subscribe to visible range changes for lazy loading
    const onVisibleRangeChange = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      const totalBars = allPointsRef.current.length;
      if (totalBars === 0) return;

      // If user has scrolled so that the leftmost visible bar is within
      // the first 1/3 of loaded data, fetch more
      const scrollThreshold = totalBars / 3;
      if (range.from <= scrollThreshold && hasMoreDataRef.current) {
        loadOlderCandles();
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);

    const fetchMarketStates = async () => {
      try {
        const res = await fetch(
          `${apiUrl}/api/market-states?feedId=${feedId}&limit=200`
        );
        if (!res.ok) return;
        const data: { state: string; timestamp: number }[] = await res.json();
        if (feedIdRef.current !== feedId) return;

        // Store all states sorted by time — drawOverlayLines filters dynamically
        // based on the current candle range (which extends as lazy loading adds data)
        rawMarketStatesRef.current = [...data].sort((a, b) => a.timestamp - b.timestamp);

        drawOverlayLines();
      } catch {
        // Market state API not available
      }
    };

    fetchCandles().then(fetchMarketStates);

    return () => {
      chart.unsubscribeCrosshairMove(drawOverlayLines);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(drawOverlayLines);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
      window.removeEventListener("resize", handleResize);
      if (overlayCanvasRef.current) {
        overlayCanvasRef.current.remove();
        overlayCanvasRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [feedId, selectedIdx, apiUrl, selected.interval, selected.movementMs]);

  // Live price tick update
  useEffect(() => {
    if (!seriesRef.current || currentPrice <= 0) return;
    if (feedIdRef.current !== feedId) return;

    const intervalMs = 60000;
    const now = Math.floor(Date.now() / intervalMs) * (intervalMs / 1000);

    const point = { time: now as Time, value: currentPrice };
    seriesRef.current.update(point);

    // Keep allPointsRef in sync for lazy-load range calculations
    const pts = allPointsRef.current;
    if (pts.length > 0 && pts[pts.length - 1].time === point.time) {
      pts[pts.length - 1] = point;
    } else {
      pts.push(point);
    }

    // Update movement live
    const sp = startPriceRef.current;
    if (sp > 0) {
      const changePercent = ((currentPrice - sp) / sp) * 100;
      setMovement({ changePercent });
    }
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
              <span className="ml-1 text-[10px]" style={{ color: "var(--dim-text)" }}>{selected.label}</span>
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

"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  type CandlestickData,
  type Time,
} from "lightweight-charts";

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
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastPriceRef = useRef(currentPrice);

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#111827" },
        textColor: "#9CA3AF",
      },
      grid: {
        vertLines: { color: "#1F2937" },
        horzLines: { color: "#1F2937" },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: "#374151",
      },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: 400,
    });

    const series = chart.addCandlestickSeries({
      upColor: "#22C55E",
      downColor: "#EF4444",
      borderDownColor: "#EF4444",
      borderUpColor: "#22C55E",
      wickDownColor: "#EF4444",
      wickUpColor: "#22C55E",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Resize handler
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Fetch candle data when feed changes
  useEffect(() => {
    if (!seriesRef.current) return;

    const fetchCandles = async () => {
      try {
        const res = await fetch(
          `${apiUrl}/api/candles?feedId=${feedId}&interval=1m&limit=200`
        );
        if (!res.ok) return;
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
          const candles: CandlestickData<Time>[] = data.map(
            (c: { timestamp: number; open: number; high: number; low: number; close: number }) => ({
              time: (c.timestamp / 1000) as Time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            })
          );
          seriesRef.current?.setData(candles);
        }
      } catch {
        // Oracle API not available — use price ticks
      }
    };

    fetchCandles();
  }, [feedId, apiUrl]);

  // Update with live price tick
  useEffect(() => {
    if (!seriesRef.current || currentPrice <= 0) return;

    const now = Math.floor(Date.now() / 60000) * 60; // round to minute
    const price = currentPrice;
    const prevPrice = lastPriceRef.current || price;
    lastPriceRef.current = price;

    seriesRef.current.update({
      time: now as Time,
      open: prevPrice,
      high: Math.max(prevPrice, price),
      low: Math.min(prevPrice, price),
      close: price,
    });
  }, [currentPrice]);

  return (
    <div className="relative">
      <div className="absolute top-2 left-2 z-10">
        <span className="text-gray-400 text-sm">{feedName} / USD</span>
        <span className="text-white text-lg font-mono ml-3">
          ${currentPrice > 0 ? currentPrice.toFixed(2) : "---"}
        </span>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

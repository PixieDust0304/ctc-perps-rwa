"use client";

import { useEffect, useState } from "react";

interface PnLPopupProps {
  isOpen: boolean;
  onClose: () => void;
  pnlUsd: number;
  pnlPercent: number;
  collateral: number;
  sizeUsd: number;
  leverage: number;
  asset: string;
  isLong: boolean;
  entryPrice: number;
}

export function PnLPopup({
  isOpen,
  onClose,
  pnlUsd,
  pnlPercent,
  collateral,
  sizeUsd,
  leverage,
  asset,
  isLong,
  entryPrice,
}: PnLPopupProps) {
  const [visible, setVisible] = useState(false);
  const [particles, setParticles] = useState<
    { x: number; y: number; size: number; color: string; delay: number }[]
  >([]);

  const isProfit = pnlUsd >= 0;

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      // Generate particle confetti
      const cols = isProfit
        ? ["#22c55e", "#4ade80", "#86efac", "#fbbf24", "#f59e0b", "#ffffff"]
        : ["#ef4444", "#f87171", "#fca5a5", "#fb923c", "#f97316", "#ffffff"];
      setParticles(
        Array.from({ length: 40 }, () => ({
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: Math.random() * 6 + 2,
          color: cols[Math.floor(Math.random() * cols.length)],
          delay: Math.random() * 0.8,
        }))
      );
    } else {
      setVisible(false);
    }
  }, [isOpen, isProfit]);

  if (!isOpen) return null;

  const bgGradient = isProfit
    ? "from-green-950 via-emerald-900 to-green-950"
    : "from-red-950 via-rose-900 to-red-950";

  const accentGradient = isProfit
    ? "from-green-400 via-emerald-300 to-yellow-400"
    : "from-red-400 via-rose-300 to-orange-400";

  const borderColor = isProfit ? "border-green-500/40" : "border-red-500/40";

  const glowColor = isProfit
    ? "shadow-[0_0_80px_rgba(34,197,94,0.3),0_0_160px_rgba(34,197,94,0.1)]"
    : "shadow-[0_0_80px_rgba(239,68,68,0.3),0_0_160px_rgba(239,68,68,0.1)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-[420px] rounded-2xl border ${borderColor} bg-gradient-to-b ${bgGradient} ${glowColor} overflow-hidden transition-all duration-500 ${
          visible ? "scale-100 opacity-100" : "scale-90 opacity-0"
        }`}
      >
        {/* Animated particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {particles.map((p, i) => (
            <div
              key={i}
              className="absolute rounded-full animate-pnl-float-up"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                opacity: 0.6,
                animationDelay: `${p.delay}s`,
                animationDuration: `${2 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>

        {/* Header bar */}
        <div className="relative px-6 pt-5 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-wider text-gray-400 uppercase">
              Position Closed
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg"
          >
            x
          </button>
        </div>

        {/* Main PnL display */}
        <div className="relative px-6 py-6 text-center">
          {/* Asset + direction */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded ${
                isLong
                  ? "bg-green-900/60 text-green-400"
                  : "bg-red-900/60 text-red-400"
              }`}
            >
              {isLong ? "LONG" : "SHORT"}
            </span>
            <span className="text-white font-semibold text-lg">{asset}</span>
            <span className="text-gray-400 text-sm">{leverage.toFixed(0)}x</span>
          </div>

          {/* Big PnL percentage */}
          <div
            className={`text-6xl font-black tracking-tight bg-gradient-to-r ${accentGradient} bg-clip-text text-transparent leading-none mb-2`}
          >
            {isProfit ? "+" : ""}
            {pnlPercent.toFixed(2)}%
          </div>

          {/* PnL in USD */}
          <div
            className={`text-2xl font-bold mt-2 ${
              isProfit ? "text-green-400" : "text-red-400"
            }`}
          >
            {isProfit ? "+$" : "-$"}
            {Math.abs(pnlUsd).toFixed(2)}
          </div>

          {/* Flavor text */}
          <p className="text-gray-500 text-sm mt-3">
            {isProfit
              ? pnlPercent > 20
                ? "Legendary trade."
                : pnlPercent > 5
                  ? "Well played."
                  : "Solid."
              : pnlPercent < -20
                ? "Brutal."
                : pnlPercent < -5
                  ? "Tough break."
                  : "Minor scratch."}
          </p>
        </div>

        {/* Stats grid */}
        <div className="relative mx-6 mb-6 bg-black/30 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-500 text-xs">Collateral</span>
            <p className="text-white font-mono">${collateral.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Position Size</span>
            <p className="text-white font-mono">${sizeUsd.toFixed(0)}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Leverage</span>
            <p className="text-white font-mono">{leverage.toFixed(0)}x</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Entry Price</span>
            <p className="text-white font-mono">${entryPrice.toFixed(2)}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="relative border-t border-white/5 px-6 py-3 flex items-center justify-between">
          <span className="text-gray-600 text-xs font-mono">CTC Perps</span>
          <span className="text-gray-600 text-xs">
            {new Date().toLocaleDateString()}
          </span>
        </div>
      </div>

    </div>
  );
}

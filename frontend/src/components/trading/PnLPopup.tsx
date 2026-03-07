"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { toPng } from "html-to-image";
import { PacManLogo } from "../AppSidebar";

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

function buildTweetUrl(props: {
  pnlUsd: number;
  pnlPercent: number;
  asset: string;
  isLong: boolean;
  leverage: number;
  isProfit: boolean;
}) {
  const emoji = props.isProfit ? "🟢" : "🔴";
  const sign = props.isProfit ? "+" : "";
  const dir = props.isLong ? "Long" : "Short";
  const text = [
    `${emoji} ${dir} ${props.asset} ${props.leverage.toFixed(0)}x on @pErp_man`,
    `${sign}${props.pnlPercent.toFixed(2)}% (${sign}$${Math.abs(props.pnlUsd).toFixed(2)})`,
    props.isProfit ? "WAKA WAKA! 🏆" : "GAME OVER 💀",
    "",
    "Trade commodities perps 👇",
  ].join("\n");
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
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
    { x: number; y: number; size: number; color: string; delay: number; dur: number }[]
  >([]);
  const cardRef = useRef<HTMLDivElement>(null);

  const isProfit = pnlUsd >= 0;

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      const cols = isProfit
        ? ["#FFD400", "#FFEB3B", "#00E676", "#69F0AE", "#F59E0B", "#fff"]
        : ["#FF1744", "#FF5252", "#FF8A80", "#FF6D00", "#FF9100", "#fff"];
      setParticles(
        Array.from({ length: 30 }, () => ({
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: Math.random() * 5 + 2,
          color: cols[Math.floor(Math.random() * cols.length)],
          delay: Math.random() * 1,
          dur: 2.5 + Math.random() * 2,
        }))
      );
    } else {
      setVisible(false);
    }
  }, [isOpen, isProfit]);

  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        backgroundColor: "#0a0a0a",
      });
      const link = document.createElement("a");
      link.download = `perpman-${asset.toLowerCase()}-${isProfit ? "win" : "loss"}.png`;
      link.href = dataUrl;
      link.click();
      const tweetUrl = buildTweetUrl({ pnlUsd, pnlPercent, asset, isLong, leverage, isProfit });
      window.open(tweetUrl, "_blank", "noopener,noreferrer");
    } catch {
      const tweetUrl = buildTweetUrl({ pnlUsd, pnlPercent, asset, isLong, leverage, isProfit });
      window.open(tweetUrl, "_blank", "noopener,noreferrer");
    }
  }, [pnlUsd, pnlPercent, asset, isLong, leverage, isProfit]);

  if (!isOpen) return null;

  const flavorText = isProfit
    ? pnlPercent > 20 ? "WAKA WAKA! 🏆" : pnlPercent > 5 ? "POWER PELLET! ⚡" : "HIGH SCORE! 🎯"
    : pnlPercent < -20 ? "GAME OVER 💀" : pnlPercent < -5 ? "Insert Coin 🪙" : "Try Again 🕹️";

  const glow = isProfit ? "0, 230, 118" : "255, 23, 68";
  const accent = isProfit ? "#00E676" : "#FF1744";
  const accentDim = isProfit ? "rgba(0, 230, 118, 0.15)" : "rgba(255, 23, 68, 0.15)";
  const accentMid = isProfit ? "rgba(0, 230, 118, 0.25)" : "rgba(255, 23, 68, 0.25)";

  const exitPrice = collateral > 0 && pnlPercent !== 0
    ? entryPrice * (1 + (isLong ? pnlPercent : -pnlPercent) / (leverage * 100))
    : entryPrice;

  const stats = [
    { label: "ENTRY", value: `$${entryPrice.toFixed(2)}` },
    { label: "EXIT", value: `$${exitPrice.toFixed(2)}` },
    { label: "SIZE", value: `$${sizeUsd.toFixed(0)}` },
    { label: "LEVERAGE", value: `${leverage.toFixed(0)}x` },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: "rgba(0, 0, 0, 0.88)",
          backdropFilter: "blur(8px)",
          opacity: visible ? 1 : 0,
        }}
      />

      {/* Card */}
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="relative overflow-hidden transition-all duration-500"
        style={{
          width: 480,
          borderRadius: 20,
          background: isProfit
            ? "linear-gradient(160deg, #0a1a05 0%, #050d02 20%, #0a0a0a 45%, #001a0d 70%, #050d02 100%)"
            : "linear-gradient(160deg, #1a0508 0%, #0d0205 20%, #0a0a0a 45%, #1a0500 70%, #0d0205 100%)",
          border: `2px solid ${isProfit ? "rgba(0, 230, 118, 0.3)" : "rgba(255, 23, 68, 0.25)"}`,
          boxShadow: [
            `0 0 40px rgba(${glow}, 0.2)`,
            `0 0 100px rgba(${glow}, 0.1)`,
            `0 0 200px rgba(${glow}, 0.05)`,
            `inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
            `inset 0 0 60px rgba(${glow}, 0.03)`,
          ].join(", "),
          transform: visible ? "scale(1)" : "scale(0.88)",
          opacity: visible ? 1 : 0,
        }}
      >
        {/* ─── Gradient border ring ─── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            borderRadius: 20,
            padding: 2,
            background: isProfit
              ? "linear-gradient(160deg, rgba(0,230,118,0.5), rgba(255,212,0,0.3), rgba(0,230,118,0.12), rgba(255,212,0,0.4))"
              : "linear-gradient(160deg, rgba(255,23,68,0.5), rgba(255,109,0,0.3), rgba(255,23,68,0.12), rgba(255,109,0,0.4))",
            mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            maskComposite: "exclude",
            WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
          }}
        />

        {/* ─── Holographic foil overlay ─── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            borderRadius: 20,
            background: isProfit
              ? `radial-gradient(ellipse at 30% 20%, rgba(0,230,118,0.12) 0%, transparent 50%),
                 radial-gradient(ellipse at 70% 80%, rgba(255,212,0,0.10) 0%, transparent 50%),
                 radial-gradient(ellipse at 80% 20%, rgba(0,229,255,0.08) 0%, transparent 40%),
                 radial-gradient(ellipse at 20% 80%, rgba(105,240,174,0.08) 0%, transparent 40%),
                 radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.03) 0%, transparent 60%)`
              : `radial-gradient(ellipse at 30% 20%, rgba(255,23,68,0.12) 0%, transparent 50%),
                 radial-gradient(ellipse at 70% 80%, rgba(255,109,0,0.10) 0%, transparent 50%),
                 radial-gradient(ellipse at 80% 20%, rgba(255,82,82,0.08) 0%, transparent 40%),
                 radial-gradient(ellipse at 20% 80%, rgba(213,0,0,0.08) 0%, transparent 40%),
                 radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.03) 0%, transparent 60%)`,
            backgroundSize: "200% 200%",
            animation: "holo-foil 8s ease-in-out infinite",
            mixBlendMode: "screen",
          }}
        />

        {/* ─── Top-left corner shine ─── */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: 0,
            left: 0,
            width: 200,
            height: 200,
            borderRadius: "0 0 100% 0",
            background: `radial-gradient(ellipse at 0% 0%, rgba(255, 255, 255, 0.06) 0%, transparent 70%)`,
          }}
        />

        {/* ─── Bottom-right edge glow ─── */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: 0,
            right: 0,
            width: 250,
            height: 250,
            borderRadius: "100% 0 0 0",
            background: `radial-gradient(ellipse at 100% 100%, rgba(${glow}, 0.06) 0%, transparent 70%)`,
          }}
        />

        {/* Floating particles */}
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
                opacity: 0.5,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.dur}s`,
              }}
            />
          ))}
        </div>

        {/* Radial glow behind score */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "22%",
            left: "50%",
            transform: "translate(-50%, -20%)",
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(${glow}, 0.15) 0%, rgba(${glow}, 0.06) 35%, transparent 65%)`,
            animation: "pellet-pulse 3s ease-in-out infinite",
          }}
        />

        {/* Header */}
        <div className="relative px-6 pt-5 pb-2 flex items-center justify-between">
          <span
            className="text-sm font-bold tracking-widest uppercase"
            style={{ color: "#bbb" }}
          >
            Position Closed
          </span>
          <button
            onClick={onClose}
            className="hover:text-white transition-colors text-xl leading-none"
            style={{ color: "#999", padding: "4px" }}
          >
            ✕
          </button>
        </div>

        {/* ═══════ SCORE ZONE ═══════ */}
        <div className="relative px-6 pt-4 pb-6 text-center">
          {/* Asset + direction */}
          <div className="flex items-center justify-center gap-2.5 mb-6">
            <span
              className="text-sm font-bold px-2.5 py-1 rounded"
              style={{
                color: isLong ? "#FFD400" : "#FF1744",
                background: isLong ? "rgba(255, 212, 0, 0.15)" : "rgba(255, 23, 68, 0.15)",
                border: `1px solid ${isLong ? "rgba(255, 212, 0, 0.3)" : "rgba(255, 23, 68, 0.3)"}`,
                boxShadow: `0 0 12px ${isLong ? "rgba(255, 212, 0, 0.15)" : "rgba(255, 23, 68, 0.15)"}`,
              }}
            >
              {isLong ? "LONG" : "SHORT"}
            </span>
            <span className="text-white font-semibold text-xl">{asset}</span>
            <span className="text-base" style={{ color: "#bbb" }}>{leverage.toFixed(0)}x</span>
          </div>

          {/* Big PnL % */}
          <div
            style={{
              fontSize: 68,
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: "-2px",
              background: isProfit
                ? "linear-gradient(135deg, #00E676 0%, #69F0AE 30%, #FFFFFF 50%, #FFD400 70%, #00E676 100%)"
                : "linear-gradient(135deg, #FF1744 0%, #FF5252 30%, #FFFFFF 50%, #FF8A80 70%, #FF1744 100%)",
              backgroundSize: "200% 200%",
              animation: "holo-foil 6s ease-in-out infinite, score-pop 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) 0.15s forwards",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              filter: `drop-shadow(0 0 40px rgba(${glow}, 0.5)) drop-shadow(0 0 80px rgba(${glow}, 0.2))`,
              opacity: 0,
              transform: "scale(0)",
            }}
          >
            {isProfit ? "+" : ""}{pnlPercent.toFixed(2)}%
          </div>

          {/* PnL USD — glowing pill */}
          <div
            style={{
              display: "inline-block",
              marginTop: 14,
              padding: "8px 24px",
              borderRadius: 100,
              background: accentDim,
              border: `1px solid ${accentMid}`,
              boxShadow: `0 0 20px rgba(${glow}, 0.15), inset 0 0 20px rgba(${glow}, 0.05)`,
              animation: "text-fade-in 0.4s ease-out 0.4s forwards",
              opacity: 0,
            }}
          >
            <span
              style={{
                fontSize: 26,
                fontWeight: 800,
                fontFamily: "monospace",
                color: accent,
                textShadow: `0 0 20px rgba(${glow}, 0.6), 0 0 40px rgba(${glow}, 0.3)`,
              }}
            >
              {isProfit ? "+$" : "-$"}{Math.abs(pnlUsd).toFixed(2)}
            </span>
          </div>

          {/* Flavor text */}
          <div
            style={{
              marginTop: 16,
              animation: "text-fade-in 0.4s ease-out 0.55s forwards",
              opacity: 0,
            }}
          >
            <span
              style={{
                display: "inline-block",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "1px",
                color: accent,
                textShadow: `0 0 24px rgba(${glow}, 0.7), 0 0 48px rgba(${glow}, 0.3), 0 0 80px rgba(${glow}, 0.15)`,
              }}
            >
              {flavorText}
            </span>
          </div>

          {/* Share button */}
          <div
            className="mt-5 flex justify-center"
            style={{
              animation: "text-fade-in 0.4s ease-out 0.65s forwards",
              opacity: 0,
            }}
          >
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full transition-all hover:scale-105 cursor-pointer"
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: `1px solid rgba(${glow}, 0.2)`,
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                boxShadow: `0 0 16px rgba(${glow}, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.08)`,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share
            </button>
          </div>
        </div>

        {/* ═══════ STATS ZONE ═══════ */}
        <div
          className="relative mx-5 mb-5 grid grid-cols-4 gap-0 overflow-hidden"
          style={{
            borderRadius: 14,
            border: `1px solid ${accentMid}`,
            background: "rgba(0, 0, 0, 0.35)",
            boxShadow: `inset 0 0 30px rgba(${glow}, 0.04), 0 0 20px rgba(${glow}, 0.06)`,
          }}
        >
          {stats.map((s, i) => (
            <div
              key={s.label}
              className="text-center py-4 px-2"
              style={{
                borderRight: i < 3 ? `1px solid rgba(${glow}, 0.12)` : "none",
                background: `linear-gradient(180deg, rgba(${glow}, 0.06) 0%, transparent 100%)`,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "1.5px",
                  color: accent,
                  marginBottom: 8,
                  textShadow: `0 0 8px rgba(${glow}, 0.3)`,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: "#fff",
                  fontFamily: "monospace",
                  fontWeight: 800,
                  textShadow: `0 0 12px rgba(${glow}, 0.3)`,
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="relative flex items-center justify-between px-6 py-3"
          style={{ borderTop: `1px solid rgba(${glow}, 0.1)` }}
        >
          <div className="flex items-center gap-2">
            <PacManLogo size={20} />
            <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: isProfit ? "#F59E0B" : "#FF5252" }}>
              pErp-man
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{
                width: 4, height: 4, borderRadius: "50%",
                background: isProfit ? "#FFD700" : "#FF1744",
                opacity: 0.3 + i * 0.2,
                boxShadow: `0 0 4px ${isProfit ? "rgba(255, 215, 0, 0.4)" : "rgba(255, 23, 68, 0.4)"}`,
              }} />
            ))}
            <span style={{ fontSize: 11, color: "#999", marginLeft: 4 }}>
              {new Date().toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

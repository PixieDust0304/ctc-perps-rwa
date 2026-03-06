"use client";

import { useEffect, useState, useRef } from "react";

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

/* ─── Share on Twitter ─────────────────────────────────── */
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
  const [pacPhase, setPacPhase] = useState(0); // 0→1 for pac-man eating progress
  const [showGhost, setShowGhost] = useState(false);
  const [confettiPieces, setConfettiPieces] = useState<
    { id: number; x: number; y: number; rot: number; color: string; size: number; delay: number; shape: string }[]
  >([]);
  const animFrameRef = useRef<number>(0);

  const isProfit = pnlUsd >= 0;

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setShowGhost(false);
      setPacPhase(0);

      if (isProfit) {
        // Generate confetti burst
        const colors = ["#FFD700", "#FFEB3B", "#F59E0B", "#FF9800", "#FF1744", "#fff", "#00E5FF", "#FF69B4"];
        const pieces = Array.from({ length: 60 }, (_, i) => {
          const angle = (Math.PI * 2 * i) / 60 + (Math.random() - 0.5) * 0.5;
          const dist = 100 + Math.random() * 250;
          return {
            id: i,
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist - 80,
            rot: Math.random() * 720 - 360,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: Math.random() * 8 + 4,
            delay: Math.random() * 0.4,
            shape: Math.random() > 0.6 ? "circle" : Math.random() > 0.5 ? "rect" : "star",
          };
        });
        setConfettiPieces(pieces);
      } else {
        // Animate pac-man eating dots
        setConfettiPieces([]);
        const start = performance.now();
        const duration = 2800;
        const tick = (now: number) => {
          const p = Math.min((now - start) / duration, 1);
          setPacPhase(p);
          if (p >= 0.85) setShowGhost(true);
          if (p < 1) {
            animFrameRef.current = requestAnimationFrame(tick);
          }
        };
        animFrameRef.current = requestAnimationFrame(tick);
      }
    } else {
      setVisible(false);
      setShowGhost(false);
      setPacPhase(0);
      setConfettiPieces([]);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isOpen, isProfit]);

  if (!isOpen) return null;

  const flavorText = isProfit
    ? pnlPercent > 20 ? "WAKA WAKA! 🏆" : pnlPercent > 5 ? "POWER PELLET! ⚡" : "HIGH SCORE! 🎯"
    : pnlPercent < -20 ? "GAME OVER 💀" : pnlPercent < -5 ? "Insert Coin 🪙" : "Try Again 🕹️";

  const dotCount = Math.min(Math.max(Math.ceil(Math.abs(pnlUsd) / 5), 8), 18);

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
        onClick={(e) => e.stopPropagation()}
        className="relative overflow-hidden transition-all duration-500"
        style={{
          width: 480,
          borderRadius: 20,
          background: isProfit
            ? "linear-gradient(160deg, #1a1500 0%, #0d0a00 30%, #1a1500 60%, #0d0a00 100%)"
            : "linear-gradient(160deg, #1a0005 0%, #0d0d0d 30%, #1a0005 60%, #0d0d0d 100%)",
          border: `2px solid ${isProfit ? "rgba(0, 230, 118, 0.25)" : "rgba(255, 23, 68, 0.2)"}`,
          boxShadow: isProfit
            ? "0 0 80px rgba(0, 230, 118, 0.12), 0 0 200px rgba(0, 230, 118, 0.04), inset 0 1px 0 rgba(0, 230, 118, 0.1)"
            : "0 0 80px rgba(255, 23, 68, 0.12), 0 0 200px rgba(255, 23, 68, 0.04), inset 0 1px 0 rgba(255,23,68,0.1)",
          transform: visible ? "scale(1)" : "scale(0.85)",
          opacity: visible ? 1 : 0,
        }}
      >
        {/* ════════════════════════════════════════════════
            ANIMATION ZONE — The main attraction
            ════════════════════════════════════════════════ */}
        <div
          className="relative overflow-hidden"
          style={{ height: 260 }}
        >
          {/* ─── PROFIT: Confetti + Duck + Cake ──────── */}
          {isProfit && (
            <>
              {/* Confetti burst from center */}
              <div className="absolute inset-0 pointer-events-none">
                {confettiPieces.map((p) => (
                  <div
                    key={p.id}
                    className="absolute"
                    style={{
                      left: "50%",
                      top: "45%",
                      width: p.size,
                      height: p.shape === "rect" ? p.size * 0.4 : p.size,
                      borderRadius: p.shape === "circle" ? "50%" : p.shape === "star" ? "2px" : "1px",
                      backgroundColor: p.color,
                      animation: `confetti-fly ${1.2 + p.delay}s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${p.delay}s forwards`,
                      ["--tx" as string]: `${p.x}px`,
                      ["--ty" as string]: `${p.y}px`,
                      ["--tr" as string]: `${p.rot}deg`,
                    }}
                  />
                ))}
              </div>

              {/* Duck (CSS pixel art) */}
              <div
                className="absolute"
                style={{
                  left: "18%",
                  bottom: 20,
                  animation: "duck-bounce 0.8s ease-out 0.3s forwards",
                  opacity: 0,
                  transform: "translateY(40px) scale(0.8)",
                }}
              >
                {/* Duck body */}
                <div style={{
                  width: 90, height: 70, borderRadius: "50% 50% 45% 45%",
                  background: "linear-gradient(135deg, #FFD700, #F59E0B)",
                  position: "relative",
                  boxShadow: "0 4px 20px rgba(255, 215, 0, 0.3)",
                }}>
                  {/* Head */}
                  <div style={{
                    width: 50, height: 45, borderRadius: "50%",
                    background: "linear-gradient(135deg, #FFEB3B, #FFD700)",
                    position: "absolute", top: -25, left: 15,
                    boxShadow: "0 2px 10px rgba(255, 215, 0, 0.2)",
                  }}>
                    {/* Eye */}
                    <div style={{
                      width: 10, height: 12, borderRadius: "50%",
                      background: "#FF1744", position: "absolute", top: 10, right: 10,
                      boxShadow: "inset 2px -1px 0 2px rgba(0,0,0,0.2)",
                    }}>
                      <div style={{
                        width: 4, height: 4, borderRadius: "50%",
                        background: "white", position: "absolute", top: 2, left: 2,
                      }} />
                    </div>
                    {/* Beak */}
                    <div style={{
                      width: 0, height: 0,
                      borderTop: "6px solid transparent",
                      borderBottom: "6px solid transparent",
                      borderLeft: "14px solid #FF1744",
                      position: "absolute", top: 18, right: -12,
                    }} />
                  </div>
                  {/* Wing */}
                  <div style={{
                    width: 30, height: 40, borderRadius: "50%",
                    background: "rgba(245, 158, 11, 0.7)",
                    position: "absolute", top: 10, left: -5,
                    transform: "rotate(20deg)",
                  }} />
                  {/* PERP text */}
                  <div style={{
                    position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
                    fontSize: 11, fontWeight: 900, color: "#0D0D0D", fontFamily: "monospace",
                    letterSpacing: 1,
                  }}>
                    PERP
                  </div>
                  {/* Feet */}
                  <div style={{
                    position: "absolute", bottom: -8, left: 15,
                    width: 18, height: 8, borderRadius: "0 0 8px 8px",
                    background: "#FF9800",
                  }} />
                  <div style={{
                    position: "absolute", bottom: -8, right: 15,
                    width: 18, height: 8, borderRadius: "0 0 8px 8px",
                    background: "#FF9800",
                  }} />
                </div>
              </div>

              {/* Cake slice */}
              <div
                className="absolute"
                style={{
                  right: "18%",
                  bottom: 20,
                  animation: "cake-pop 0.6s cubic-bezier(0.68, -0.55, 0.27, 1.55) 0.8s forwards",
                  opacity: 0,
                  transform: "scale(0)",
                }}
              >
                <div style={{ position: "relative", width: 70, height: 80 }}>
                  {/* Cake triangle */}
                  <div style={{
                    width: 0, height: 0,
                    borderLeft: "35px solid transparent",
                    borderRight: "35px solid transparent",
                    borderBottom: "65px solid #F59E0B",
                    filter: "drop-shadow(0 4px 12px rgba(245, 158, 11, 0.3))",
                  }} />
                  {/* Frosting */}
                  <div style={{
                    position: "absolute", top: 18, left: 12,
                    width: 46, height: 52,
                    clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
                    background: "linear-gradient(180deg, #FFEB3B, #FFD700)",
                  }} />
                  {/* Cherry */}
                  <div style={{
                    position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                    width: 14, height: 14, borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 35%, #FF5252, #FF1744)",
                    boxShadow: "0 2px 8px rgba(255, 23, 68, 0.4)",
                  }} />
                  {/* Sprinkles */}
                  {[
                    { x: 20, y: 40, r: 30, c: "#FF1744" },
                    { x: 42, y: 50, r: -20, c: "#2196F3" },
                    { x: 30, y: 58, r: 45, c: "#4CAF50" },
                  ].map((s, i) => (
                    <div key={i} style={{
                      position: "absolute", left: s.x, top: s.y,
                      width: 6, height: 3, borderRadius: 2,
                      background: s.c, transform: `rotate(${s.r}deg)`,
                    }} />
                  ))}
                </div>
              </div>

              {/* Pellet trail */}
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: i % 4 === 0 ? 10 : 6,
                      height: i % 4 === 0 ? 10 : 6,
                      borderRadius: "50%",
                      background: "#FFD700",
                      opacity: 0.4,
                      animation: `pellet-pulse 0.6s ease-in-out ${i * 0.1}s infinite`,
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {/* ─── LOSS: Pac-Man Chomping Dots ────────── */}
          {!isProfit && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8">
              {/* Pac-Man eating zone */}
              <div className="relative w-full" style={{ height: 80 }}>
                {/* Dot row */}
                <div className="absolute inset-0 flex items-center justify-center gap-2">
                  {Array.from({ length: dotCount }).map((_, i) => {
                    const eaten = i < pacPhase * dotCount;
                    const isPowerPellet = i % 5 === 0;
                    return (
                      <div
                        key={i}
                        style={{
                          width: isPowerPellet ? 16 : 8,
                          height: isPowerPellet ? 16 : 8,
                          borderRadius: "50%",
                          background: eaten ? "transparent" : "#FFD700",
                          boxShadow: eaten ? "none" : `0 0 ${isPowerPellet ? 8 : 4}px rgba(255, 215, 0, ${isPowerPellet ? 0.6 : 0.3})`,
                          transition: "all 0.15s ease-out",
                          transform: eaten ? "scale(0)" : "scale(1)",
                        }}
                      />
                    );
                  })}
                </div>

                {/* Pac-Man ball (pure CSS) */}
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: `${Math.max(5, pacPhase * 85)}%`,
                    transform: "translate(-50%, -50%)",
                    transition: "left 0.1s linear",
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 40% 35%, #FFEB3B, #FFD700, #F59E0B)",
                      position: "relative",
                      animation: "pac-chomp 0.3s ease-in-out infinite",
                      boxShadow: "0 0 20px rgba(255, 215, 0, 0.4)",
                    }}
                  >
                    {/* Eye */}
                    <div style={{
                      position: "absolute", top: 8, left: 22,
                      width: 8, height: 10, borderRadius: "50%",
                      background: "#FF1744",
                    }}>
                      <div style={{
                        width: 3, height: 3, borderRadius: "50%",
                        background: "white", position: "absolute", top: 2, left: 2,
                      }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Ghost appears */}
              <div
                style={{
                  marginTop: 16,
                  opacity: showGhost ? 1 : 0,
                  transform: showGhost ? "translateY(0) scale(1)" : "translateY(20px) scale(0.6)",
                  transition: "all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                {/* CSS Ghost */}
                <div style={{ position: "relative", width: 44, height: 52 }}>
                  <div style={{
                    width: 44, height: 38, borderRadius: "22px 22px 0 0",
                    background: "linear-gradient(180deg, #FF1744, #D50000)",
                    boxShadow: "0 0 20px rgba(255, 23, 68, 0.4)",
                  }} />
                  {/* Ghost bottom zigzag */}
                  <div style={{
                    display: "flex", marginTop: -1,
                  }}>
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} style={{
                        width: 11, height: 14,
                        background: i % 2 === 0 ? "linear-gradient(180deg, #FF1744, #D50000)" : "transparent",
                        borderRadius: i % 2 === 0 ? "0 0 50% 50%" : 0,
                      }} />
                    ))}
                  </div>
                  {/* Ghost eyes */}
                  <div style={{ position: "absolute", top: 12, left: 6, display: "flex", gap: 6 }}>
                    {[0, 1].map((i) => (
                      <div key={i} style={{
                        width: 12, height: 14, borderRadius: "50%", background: "white",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <div style={{ width: 7, height: 8, borderRadius: "50%", background: "#2196F3" }} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Flavor text overlay */}
          <div
            className="absolute bottom-0 left-0 right-0 text-center pb-3"
            style={{
              animation: "text-fade-in 0.5s ease-out 0.5s forwards",
              opacity: 0,
            }}
          >
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: isProfit ? "#00E676" : "#FF5252",
                textShadow: isProfit
                  ? "0 0 20px rgba(0, 230, 118, 0.5)"
                  : "0 0 20px rgba(255, 82, 82, 0.5)",
              }}
            >
              {flavorText}
            </span>
          </div>
        </div>

        {/* ════════════════════════════════════════════════
            RESULTS ZONE — Compact below animations
            ════════════════════════════════════════════════ */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.4)",
            borderTop: `1px solid ${isProfit ? "rgba(0, 230, 118, 0.1)" : "rgba(255, 23, 68, 0.1)"}`,
            padding: "20px 24px 16px",
          }}
        >
          {/* Asset + Direction badge */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <span
              style={{
                fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 4,
                color: isLong ? "#FFD700" : "#FF1744",
                background: isLong ? "rgba(255, 215, 0, 0.12)" : "rgba(255, 23, 68, 0.12)",
              }}
            >
              {isLong ? "LONG" : "SHORT"}
            </span>
            <span style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{asset}</span>
            <span style={{ color: "#888", fontSize: 12 }}>{leverage.toFixed(0)}x</span>
          </div>

          <div className="text-center mb-6" style={{ animation: "score-pop 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) 0.2s forwards", opacity: 0, transform: "scale(0)" }}>
            <div style={{
              fontSize: 48, fontWeight: 900, lineHeight: 1,
              background: isProfit
                ? "linear-gradient(135deg, #00E676, #69F0AE)"
                : "linear-gradient(135deg, #FF1744, #FF5252, #FF8A80)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              {isProfit ? "+" : ""}{pnlPercent.toFixed(2)}%
            </div>
            <div style={{
              fontSize: 20, fontWeight: 700, marginTop: 4,
              color: isProfit ? "#00E676" : "#FF1744",
            }}>
              {isProfit ? "+$" : "-$"}{Math.abs(pnlUsd).toFixed(2)}
            </div>
            {/* Share on Twitter - integrated right beneath result */}
            <div className="mt-4 flex justify-center">
              <a
                href={buildTweetUrl({ pnlUsd, pnlPercent, asset, isLong, leverage, isProfit })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-full transition-all hover:scale-105"
                style={{
                  background: "var(--coal-lighter)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "var(--soft-white)",
                  fontSize: 12,
                  fontWeight: 600,
                  boxShadow: "0 0 10px rgba(255, 138, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Share
              </a>
            </div>
          </div>

          {/* Stats row */}
          <div
            className="grid grid-cols-4 gap-2 mt-4 text-center"
            style={{
              background: "rgba(0, 0, 0, 0.3)",
              borderRadius: 10, padding: "10px 8px",
              border: "1px solid rgba(255, 255, 255, 0.04)",
            }}
          >
            {[
              { label: "Collateral", value: `$${collateral.toFixed(0)}` },
              { label: "Size", value: `$${sizeUsd.toFixed(0)}` },
              { label: "Leverage", value: `${leverage.toFixed(0)}x` },
              { label: "Entry", value: `$${entryPrice.toFixed(2)}` },
            ].map((s) => (
              <div key={s.label}>
                <div style={{ fontSize: 10, color: "#666" }}>{s.label}</div>
                <div style={{ fontSize: 13, color: "white", fontFamily: "monospace", fontWeight: 600, marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex justify-end">
            {/* Close button */}
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-lg transition-all hover:bg-white/10"
              style={{
                background: "rgba(255, 255, 255, 0.06)",
                color: "#999",
                fontWeight: 600,
                fontSize: 13,
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-2"
          style={{ borderTop: "1px solid rgba(255, 255, 255, 0.04)" }}
        >
          <span style={{ fontSize: 10, fontFamily: "monospace", color: isProfit ? "#F59E0B" : "#FF5252" }}>
            pErp-man
          </span>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{
                width: 3, height: 3, borderRadius: "50%",
                background: isProfit ? "#FFD700" : "#FF1744",
                opacity: 0.2 + i * 0.2,
              }} />
            ))}
            <span style={{ fontSize: 10, color: "#444", marginLeft: 4 }}>
              {new Date().toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

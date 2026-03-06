"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { MarketSelector } from "../components/trading/MarketSelector";
import { OrderPanel } from "../components/trading/OrderPanel";
import { MarketStatusBanner } from "../components/trading/MarketStatusBanner";
import { PriceChart } from "../components/trading/PriceChart";
import { PositionsPanel } from "../components/trading/PositionsPanel";
import { PnLPopup } from "../components/trading/PnLPopup";

import { FaucetButton } from "../components/trading/FaucetButton";
import { usePrices } from "../hooks/usePrices";
import { useState } from "react";
import Link from "next/link";

/* ─── Pixel Pac-Man Logo (SVG) ─────────────────────────── */
function PacManLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ imageRendering: "pixelated" }}>
      {/* Pac-Man body — pixel circle with mouth */}
      <rect x="8" y="2" width="16" height="2" fill="#FFD400" />
      <rect x="6" y="4" width="4" height="2" fill="#FFD400" />
      <rect x="10" y="4" width="12" height="2" fill="#FFD400" />
      <rect x="22" y="4" width="4" height="2" fill="#FFD400" />
      <rect x="4" y="6" width="4" height="2" fill="#FFD400" />
      <rect x="8" y="6" width="16" height="2" fill="#FFD400" />
      <rect x="24" y="6" width="4" height="2" fill="#FFD400" />
      <rect x="2" y="8" width="6" height="2" fill="#FFD400" />
      <rect x="8" y="8" width="16" height="2" fill="#FFD400" />
      <rect x="24" y="8" width="6" height="2" fill="#FFD400" />
      <rect x="2" y="10" width="6" height="2" fill="#FFD400" />
      <rect x="8" y="10" width="10" height="2" fill="#FFD400" />
      {/* Mouth gap — right side open */}
      <rect x="2" y="12" width="6" height="2" fill="#FFD400" />
      <rect x="8" y="12" width="6" height="2" fill="#FFD400" />
      <rect x="2" y="14" width="6" height="2" fill="#FFD400" />
      <rect x="8" y="14" width="6" height="2" fill="#FFD400" />
      <rect x="2" y="16" width="6" height="2" fill="#FFD400" />
      <rect x="8" y="16" width="10" height="2" fill="#FFD400" />
      <rect x="2" y="18" width="6" height="2" fill="#FFD400" />
      <rect x="8" y="18" width="16" height="2" fill="#FFD400" />
      <rect x="24" y="18" width="6" height="2" fill="#FFD400" />
      <rect x="4" y="20" width="4" height="2" fill="#FFD400" />
      <rect x="8" y="20" width="16" height="2" fill="#FFD400" />
      <rect x="24" y="20" width="4" height="2" fill="#FFD400" />
      <rect x="4" y="22" width="4" height="2" fill="#FFD400" />
      <rect x="8" y="22" width="16" height="2" fill="#FFD400" />
      <rect x="24" y="22" width="4" height="2" fill="#FFD400" />
      <rect x="6" y="24" width="4" height="2" fill="#FFD400" />
      <rect x="10" y="24" width="12" height="2" fill="#FFD400" />
      <rect x="22" y="24" width="4" height="2" fill="#FFD400" />
      <rect x="8" y="26" width="16" height="2" fill="#FFD400" />
      {/* Eye */}
      <rect x="10" y="8" width="4" height="4" fill="#0A0A0A" />
      <rect x="12" y="8" width="2" height="2" fill="#F5F5F5" />
    </svg>
  );
}

/* ─── Small candlestick bars near logo ─────────────────── */
function MiniCandles() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="none" style={{ imageRendering: "pixelated" }}>
      {/* Green candle */}
      <rect x="2" y="4" width="2" height="2" fill="#00E676" />
      <rect x="1" y="6" width="4" height="6" fill="#00E676" />
      <rect x="2" y="12" width="2" height="2" fill="#00E676" />
      {/* Red candle */}
      <rect x="10" y="2" width="2" height="2" fill="#FF3B3B" />
      <rect x="9" y="4" width="4" height="8" fill="#FF3B3B" />
      <rect x="10" y="12" width="2" height="4" fill="#FF3B3B" />
    </svg>
  );
}

export default function TradingPage() {
  const { prices, connected, onPositionUpdate } = usePrices();
  const [selectedFeedId, setSelectedFeedId] = useState(2056);

  const selectedPrice = prices.find((p) => p.id === selectedFeedId);

  // Dev test: cycle through profit → loss → off
  const [testPnl, setTestPnl] = useState<"off" | "profit" | "loss">("off");

  return (
    <main className="min-h-screen flex" style={{ background: "var(--void-black)" }}>
      {/* ─── Discord-style Sidebar ────────────────── */}
      <aside className="sidebar-dark w-[72px] flex flex-col items-center py-4 gap-3 shrink-0">
        {/* Pac-Man Logo — pixel art, not letter "P" */}
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer transition-all hover:rounded-xl glow-brand"
          style={{ background: "var(--void-black)" }}
        >
          <PacManLogo size={32} />
        </div>

        <div style={{ width: 32, height: 2, background: "var(--coal-border)", borderRadius: 1 }} />

        {/* Nav icons */}
        {[
          { href: "/", icon: "📊", label: "Trade", active: true },
          { href: "/pool", icon: "💧", label: "Pool", active: false },
          { href: "/governance", icon: "🏛️", label: "Govern", active: false },
        ].map((nav) => (
          <Link
            key={nav.href}
            href={nav.href}
            className="group relative w-12 h-12 rounded-2xl flex items-center justify-center transition-all hover:rounded-xl"
            style={{
              background: nav.active ? "rgba(255, 212, 0, 0.1)" : "var(--coal-lighter)",
              border: nav.active ? "1px solid rgba(255, 212, 0, 0.2)" : "1px solid transparent",
            }}
          >
            <span className="text-xl">{nav.icon}</span>
            {/* Tooltip */}
            <div className="absolute left-16 bg-black text-white text-xs px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 font-body">
              {nav.label}
            </div>
            {/* Active pip */}
            {nav.active && (
              <div
                className="absolute -left-[4px] w-[4px] h-8 rounded-r-full"
                style={{ background: "var(--pixel-yellow)" }}
              />
            )}
          </Link>
        ))}

        {/* Live indicator */}
        <div className="mt-auto flex flex-col items-center gap-1">
          <div
            className="w-3 h-3 rounded-full"
            style={{
              background: connected ? "var(--profit-green)" : "var(--trade-red)",
              boxShadow: connected
                ? "0 0 8px var(--profit-green-glow)"
                : "0 0 8px var(--trade-red-glow)",
              animation: "ambient-pulse 2s ease-in-out infinite",
            }}
          />
          <span className="text-[9px] font-pixel" style={{ color: "var(--dim-text)" }}>
            {connected ? "LIVE" : "..."}
          </span>
        </div>

        {/* Dev: Test PnL button */}
        <button
          onClick={() => setTestPnl((s) => s === "off" ? "profit" : s === "profit" ? "loss" : "off")}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-sm transition-all hover:rounded-lg mb-1"
          style={{
            background: testPnl !== "off" ? "rgba(255, 212, 0, 0.12)" : "var(--coal-lighter)",
            border: testPnl !== "off" ? "1px solid rgba(255, 212, 0, 0.2)" : "1px solid transparent",
          }}
          title={`Test PnL (${testPnl})`}
        >
          🎮
        </button>
      </aside>

      {/* ─── Main Content Area ────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header
          className="h-12 flex items-center justify-between px-4 shrink-0"
          style={{
            background: "var(--coal-surface)",
            borderBottom: "1px solid var(--coal-border)",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div className="flex items-center gap-3">
            <PacManLogo size={24} />
            <MiniCandles />
            <h1 className="font-pixel text-base font-bold tracking-tight" style={{ color: "var(--pixel-yellow)" }}>
              PERP MAN
            </h1>
            <span className="text-[10px] font-body uppercase tracking-widest" style={{ color: "var(--dim-text)" }}>
              Arcade energy for perpetual trading
            </span>
          </div>
          <div className="flex items-center gap-3">
            <FaucetButton />
            <ConnectButton showBalance={false} />
          </div>
        </header>

        {/* Market Status */}
        <MarketStatusBanner
          feedId={selectedFeedId}
          fresh={selectedPrice?.fresh ?? false}
        />

        {/* Market Selector — metallic badges */}
        <MarketSelector
          prices={prices}
          selectedFeedId={selectedFeedId}
          onSelect={setSelectedFeedId}
        />

        {/* Main Trading Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3">
          {/* Chart — 3D wrapped */}
          <div className="lg:col-span-2 chart-3d-wrapper">
            <div className="chart-3d-inner">
              {/* Tetris grid overlay */}
              <div className="tetris-grid" />
              <PriceChart
                feedId={selectedFeedId}
                feedName={selectedPrice?.name ?? "Gold"}
                currentPrice={selectedPrice?.price ?? 0}
              />
            </div>
          </div>

          {/* Order Panel — 3D card */}
          <div className="card-deep p-4 flex flex-col">
            <OrderPanel
              feedId={selectedFeedId}
              currentPrice={selectedPrice?.price ?? 0}
              isMarketOpen={selectedPrice?.fresh ?? false}
            />
          </div>
        </div>

        {/* Positions */}
        <div className="px-3 pb-3">
          <PositionsPanel prices={prices} onPositionUpdate={onPositionUpdate} />
        </div>

        {/* Footer Credit */}
        <footer
          className="flex items-center justify-center py-3 px-4 gap-1 flex-wrap"
          style={{
            borderTop: "1px solid var(--coal-border)",
            background: "var(--void-black)",
          }}
        >
          <span className="text-[10px] font-pixel" style={{ color: "var(--dim-text)" }}>
            Designed & managed by
          </span>
          <a
            href="https://digitalhexa.in/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-pixel transition-all hover:brightness-125"
            style={{
              color: "var(--pixel-yellow)",
              textDecoration: "none",
              borderBottom: "1px solid rgba(255, 212, 0, 0.3)",
            }}
          >
            Digital Hexa
          </a>
          <span className="text-[10px] font-pixel" style={{ color: "var(--dim-text)" }}>
            ·
          </span>
          <span className="text-[10px] font-pixel" style={{ color: "var(--dim-text)" }}>
            BUSL-1.1
          </span>
        </footer>
      </div>

      {/* Dev test PnL popup */}
      <PnLPopup
        isOpen={testPnl !== "off"}
        onClose={() => setTestPnl("off")}
        pnlUsd={testPnl === "profit" ? 426.9 : -185.0}
        pnlPercent={testPnl === "profit" ? 42.69 : -18.5}
        collateral={1000}
        sizeUsd={10000}
        leverage={10}
        asset={testPnl === "profit" ? "Gold" : "Silver"}
        isLong={true}
        entryPrice={testPnl === "profit" ? 5100 : 5200}
      />
    </main>
  );
}

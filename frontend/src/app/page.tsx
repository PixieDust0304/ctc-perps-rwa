"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { MarketSelector } from "../components/trading/MarketSelector";
import { OrderPanel } from "../components/trading/OrderPanel";
import { MarketStatusBanner } from "../components/trading/MarketStatusBanner";
import { PriceChart } from "../components/trading/PriceChart";
import { PositionsPanel } from "../components/trading/PositionsPanel";
import { FaucetButton } from "../components/trading/FaucetButton";
import { AppSidebar, PacManLogo, MiniCandles } from "../components/AppSidebar";
import { Footer } from "../components/Footer";
import { usePrices } from "../hooks/usePrices";
import { useState } from "react";

export default function TradingPage() {
  const { prices, connected, onPositionUpdate } = usePrices();
  const [selectedFeedId, setSelectedFeedId] = useState(2056);

  const selectedPrice = prices.find((p) => p.id === selectedFeedId);

  return (
    <main className="min-h-screen flex" style={{ background: "var(--void-black)" }}>
      {/* ─── Discord-style Sidebar ────────────────── */}
      <AppSidebar connected={connected} />

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
          <div className="flex items-baseline gap-0.5">
            <div className="flex items-center gap-0.5 self-center">
              <PacManLogo size={24} />
              <MiniCandles />
            </div>
            <h1 className="font-pixel text-base font-bold tracking-tight mr-2 leading-none" style={{ color: "var(--pixel-yellow)" }}>
              pErp-man
            </h1>
            <span className="text-[10px] font-body uppercase tracking-widest leading-none" style={{ color: "var(--dim-text)" }}>
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
                isVammPrice={(selectedPrice as any)?.isVammPrice ?? false}
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

        <Footer />
      </div>

    </main>
  );
}

"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { MarketSelector } from "../components/trading/MarketSelector";
import { OrderPanel } from "../components/trading/OrderPanel";
import { MarketStatusBanner } from "../components/trading/MarketStatusBanner";
import { PriceChart } from "../components/trading/PriceChart";
import { PositionList } from "../components/trading/PositionList";
import { usePrices } from "../hooks/usePrices";
import { useState } from "react";
import Link from "next/link";

export default function TradingPage() {
  const { prices, connected } = usePrices();
  const [selectedFeedId, setSelectedFeedId] = useState(2056);

  const selectedPrice = prices.find((p) => p.id === selectedFeedId);

  return (
    <main className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-white">CTC Perps</h1>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="text-white font-medium">
              Trade
            </Link>
            <Link href="/pool" className="text-gray-400 hover:text-white">
              Pool
            </Link>
            <Link href="/governance" className="text-gray-400 hover:text-white">
              Govern
            </Link>
          </nav>
          <span className="text-xs text-gray-500">
            {connected ? "Live" : "Connecting..."}
          </span>
        </div>
        <ConnectButton />
      </header>

      {/* Market Status */}
      <MarketStatusBanner
        feedId={selectedFeedId}
        fresh={selectedPrice?.fresh ?? false}
      />

      {/* Market Selector */}
      <MarketSelector
        prices={prices}
        selectedFeedId={selectedFeedId}
        onSelect={setSelectedFeedId}
      />

      {/* Main Trading Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
        {/* Chart */}
        <div className="lg:col-span-2 bg-gray-900 rounded-lg overflow-hidden">
          <PriceChart
            feedId={selectedFeedId}
            feedName={selectedPrice?.name ?? "Gold"}
            currentPrice={selectedPrice?.price ?? 0}
          />
        </div>

        {/* Order Panel */}
        <div className="bg-gray-900 rounded-lg p-4">
          <OrderPanel
            feedId={selectedFeedId}
            currentPrice={selectedPrice?.price ?? 0}
            isMarketOpen={selectedPrice?.fresh ?? false}
          />
        </div>
      </div>

      {/* Positions */}
      <div className="px-4 pb-4">
        <PositionList prices={prices} />
      </div>
    </main>
  );
}

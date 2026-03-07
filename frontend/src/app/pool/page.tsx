"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { PoolPanel } from "../../components/pool/PoolPanel";
import { AppSidebar, PacManLogo, MiniCandles } from "../../components/AppSidebar";
import { Footer } from "../../components/Footer";

export default function PoolPage() {
  return (
    <main className="min-h-screen flex" style={{ background: "var(--void-black)" }}>
      {/* Same sidebar as Trade page */}
      <AppSidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
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
            <div className="-ml-2.5"><MiniCandles /></div>
            <h1 className="font-pixel text-base font-bold tracking-tight" style={{ color: "var(--pixel-yellow)" }}>
              PERP MAN
            </h1>
            <span className="text-[10px] font-body uppercase tracking-widest" style={{ color: "var(--dim-text)" }}>
              Liquidity Pool
            </span>
          </div>
          <ConnectButton showBalance={false} />
        </header>

        <div className="flex-1 p-6">
          <PoolPanel />
        </div>

        <Footer />
      </div>
    </main>
  );
}

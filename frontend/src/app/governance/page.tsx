"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { GovernancePanel } from "../../components/governance/GovernancePanel";
import { AppSidebar } from "../../components/AppSidebar";

export default function GovernancePage() {
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
            <h1 className="font-pixel text-base font-bold tracking-tight" style={{ color: "var(--pixel-yellow)" }}>
              PERP MAN
            </h1>
            <span className="text-[10px] font-body uppercase tracking-widest" style={{ color: "var(--dim-text)" }}>
              Governance
            </span>
          </div>
          <ConnectButton showBalance={false} />
        </header>

        <div className="flex-1 p-6">
          <GovernancePanel />
        </div>

        {/* Footer */}
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
          <span className="text-[10px] font-pixel" style={{ color: "var(--dim-text)" }}>·</span>
          <span className="text-[10px] font-pixel" style={{ color: "var(--dim-text)" }}>BUSL-1.1</span>
        </footer>
      </div>
    </main>
  );
}

"use client";

import { useState } from "react";
import { PnLPopup } from "../../components/trading/PnLPopup";

export default function TestPnLPage() {
  const [popup, setPopup] = useState<{
    isOpen: boolean;
    pnlUsd: number;
    pnlPercent: number;
    collateral: number;
    sizeUsd: number;
    leverage: number;
    asset: string;
    isLong: boolean;
    entryPrice: number;
  }>({
    isOpen: false,
    pnlUsd: 0,
    pnlPercent: 0,
    collateral: 100,
    sizeUsd: 1000,
    leverage: 10,
    asset: "Gold",
    isLong: true,
    entryPrice: 3037.7,
  });

  const scenarios = [
    { label: "Big Win (Long Gold +25%)", pnlUsd: 250, pnlPercent: 25, collateral: 100, sizeUsd: 1000, leverage: 10, asset: "Gold", isLong: true, entryPrice: 3037.7 },
    { label: "Small Win (Short Silver +3%)", pnlUsd: 15, pnlPercent: 3, collateral: 500, sizeUsd: 2500, leverage: 5, asset: "Silver", isLong: false, entryPrice: 83.0 },
    { label: "Medium Win (Long Crude +8%)", pnlUsd: 80, pnlPercent: 8, collateral: 1000, sizeUsd: 5000, leverage: 5, asset: "Crude Oil", isLong: true, entryPrice: 68.5 },
    { label: "Big Loss (Long Gold -30%)", pnlUsd: -300, pnlPercent: -30, collateral: 100, sizeUsd: 1000, leverage: 10, asset: "Gold", isLong: true, entryPrice: 3037.7 },
    { label: "Small Loss (Short Platinum -2%)", pnlUsd: -10, pnlPercent: -2, collateral: 500, sizeUsd: 2500, leverage: 5, asset: "Platinum", isLong: false, entryPrice: 2277.0 },
    { label: "Medium Loss (Long Silver -12%)", pnlUsd: -120, pnlPercent: -12, collateral: 1000, sizeUsd: 5000, leverage: 5, asset: "Silver", isLong: true, entryPrice: 83.0 },
    { label: "P2P Spot Win (Gold +5%)", pnlUsd: 50, pnlPercent: 5, collateral: 1000, sizeUsd: 1000, leverage: 1, asset: "Gold", isLong: true, entryPrice: 3037.7 },
    { label: "P2P Spot Loss (Gold -5%)", pnlUsd: -50, pnlPercent: -5, collateral: 1000, sizeUsd: 1000, leverage: 1, asset: "Gold", isLong: false, entryPrice: 3037.7 },
  ];

  return (
    <div style={{ padding: 40, background: "#0A0A0A", minHeight: "100vh" }}>
      <h1 style={{ color: "#FFD400", fontSize: 24, fontWeight: 700, marginBottom: 24, fontFamily: "monospace" }}>
        PnL Popup Test Page
      </h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 700 }}>
        {scenarios.map((s, i) => (
          <button
            key={i}
            onClick={() => setPopup({ isOpen: true, ...s })}
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              border: `1px solid ${s.pnlUsd >= 0 ? "rgba(0,230,118,0.3)" : "rgba(255,23,68,0.3)"}`,
              background: s.pnlUsd >= 0 ? "rgba(0,230,118,0.08)" : "rgba(255,23,68,0.08)",
              color: s.pnlUsd >= 0 ? "#00E676" : "#FF1744",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <PnLPopup
        isOpen={popup.isOpen}
        onClose={() => setPopup((p) => ({ ...p, isOpen: false }))}
        pnlUsd={popup.pnlUsd}
        pnlPercent={popup.pnlPercent}
        collateral={popup.collateral}
        sizeUsd={popup.sizeUsd}
        leverage={popup.leverage}
        asset={popup.asset}
        isLong={popup.isLong}
        entryPrice={popup.entryPrice}
      />
    </div>
  );
}

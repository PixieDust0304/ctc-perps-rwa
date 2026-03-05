"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { GovernancePanel } from "../../components/governance/GovernancePanel";
import Link from "next/link";

export default function GovernancePage() {
  return (
    <main className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-white">CTC Perps</h1>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="text-gray-400 hover:text-white">
              Trade
            </Link>
            <Link href="/pool" className="text-gray-400 hover:text-white">
              Pool
            </Link>
            <Link href="/governance" className="text-white font-medium">
              Govern
            </Link>
          </nav>
        </div>
        <ConnectButton />
      </header>

      <div className="p-6">
        <GovernancePanel />
      </div>
    </main>
  );
}

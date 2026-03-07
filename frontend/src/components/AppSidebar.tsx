"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* ─── SVG Icons ─────────────────────────────────────────── */

function IconChart({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
    );
}

function IconDroplet({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
        </svg>
    );
}

function IconGovernance({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="21" x2="21" y2="21" />
            <path d="M5 21V7l7-4 7 4v14" />
            <line x1="9" y1="21" x2="9" y2="14" />
            <line x1="15" y1="21" x2="15" y2="14" />
        </svg>
    );
}

/* Pac-Man SVG Logo — pixel art with mouth open */
export function PacManLogo({ size = 32 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ imageRendering: "pixelated" }}>
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

/* Small candlestick bars for header */
export function MiniCandles() {
    return (
        <svg width="16" height="20" viewBox="0 0 16 20" fill="none" style={{ imageRendering: "pixelated" }}>
            <rect x="2" y="4" width="2" height="2" fill="#00E676" />
            <rect x="1" y="6" width="4" height="6" fill="#00E676" />
            <rect x="2" y="12" width="2" height="2" fill="#00E676" />
            <rect x="10" y="2" width="2" height="2" fill="#FF3B3B" />
            <rect x="9" y="4" width="4" height="8" fill="#FF3B3B" />
            <rect x="10" y="12" width="2" height="4" fill="#FF3B3B" />
        </svg>
    );
}

const NAV_ITEMS = [
    { href: "/", icon: IconChart, label: "Trade" },
    { href: "/pool", icon: IconDroplet, label: "Pool" },
    { href: "/governance", icon: IconGovernance, label: "Govern" },
];

export function AppSidebar({ connected }: { connected?: boolean } = {}) {
    const pathname = usePathname();
    const isConnected = connected ?? true;

    return (
        <aside className="sidebar-dark w-[72px] flex flex-col items-center py-4 gap-3 shrink-0">
            {/* Pac-Man Logo */}
            <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer transition-all hover:rounded-xl glow-brand"
                style={{ background: "var(--void-black)" }}
            >
                <PacManLogo size={32} />
            </div>

            <div style={{ width: 32, height: 2, background: "var(--coal-border)", borderRadius: 1 }} />

            {/* Nav icons */}
            {NAV_ITEMS.map((nav) => {
                const active = pathname === nav.href;
                const Icon = nav.icon;
                return (
                    <Link
                        key={nav.href}
                        href={nav.href}
                        className="group relative w-12 h-12 rounded-2xl flex items-center justify-center transition-all hover:rounded-xl"
                        style={{
                            background: active ? "rgba(255, 212, 0, 0.1)" : "var(--coal-lighter)",
                            border: active ? "1px solid rgba(255, 212, 0, 0.2)" : "1px solid transparent",
                            color: active ? "var(--pixel-yellow)" : "var(--dim-text)",
                        }}
                    >
                        <Icon size={20} />
                        {/* Tooltip */}
                        <div className="absolute left-16 bg-black text-white text-xs px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 font-body">
                            {nav.label}
                        </div>
                        {/* Active pip */}
                        {active && (
                            <div
                                className="absolute -left-[4px] w-[4px] h-8 rounded-r-full"
                                style={{ background: "var(--pixel-yellow)" }}
                            />
                        )}
                    </Link>
                );
            })}

            {/* Live indicator */}
            <div className="mt-auto flex flex-col items-center gap-1">
                <div
                    className="w-3 h-3 rounded-full"
                    style={{
                        background: isConnected ? "var(--profit-green)" : "var(--trade-red)",
                        boxShadow: isConnected
                            ? "0 0 8px var(--profit-green-glow)"
                            : "0 0 8px var(--trade-red-glow)",
                        animation: "ambient-pulse 2s ease-in-out infinite",
                    }}
                />
                <span className="text-[9px] font-pixel" style={{ color: "var(--dim-text)" }}>
                    {isConnected ? "LIVE" : "..."}
                </span>
            </div>
        </aside>
    );
}

/* ─── Exported SVG Icons for reuse ──────────────────────── */
export function IconDollar({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
    );
}

export function IconVault({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <circle cx="12" cy="12" r="4" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="12" x2="14.5" y2="14" />
        </svg>
    );
}

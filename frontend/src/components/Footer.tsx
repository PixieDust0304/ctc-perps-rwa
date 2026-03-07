export function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--coal-border)",
        background: "var(--void-black)",
      }}
    >
      {/* Credit highlight — top */}
      <div
        className="flex items-center justify-center py-5 px-6 gap-3 flex-wrap"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        <span className="text-base font-pixel" style={{ color: "rgba(255,255,255,0.6)" }}>
          Designed & managed by
        </span>
        <a
          href="https://digitalhexa.in/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-lg font-pixel font-bold transition-all hover:brightness-125"
          style={{
            color: "var(--pixel-yellow)",
            textDecoration: "none",
            borderBottom: "2px solid rgba(255, 212, 0, 0.4)",
            textShadow: "0 0 12px rgba(255, 212, 0, 0.35)",
          }}
        >
          Digital Hexa
        </a>
        <span className="text-base font-pixel" style={{ color: "rgba(255,255,255,0.25)" }}>
          ·
        </span>
        <span
          className="text-xs font-pixel font-semibold px-2.5 py-1 rounded"
          style={{
            color: "rgba(255,255,255,0.55)",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          BUSL-1.1
        </span>
      </div>

      {/* Bottom section — links & info */}
      <div className="grid grid-cols-3 gap-8 px-10 py-6">
        {/* Protocol */}
        <div className="flex flex-col gap-2.5">
          <span
            className="text-sm font-pixel font-bold uppercase tracking-widest"
            style={{ color: "var(--pixel-yellow)", opacity: 0.85 }}
          >
            Protocol
          </span>
          <span
            className="text-sm font-body leading-relaxed"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            Perpetual futures for real-world commodities on CreditCoin. Trade Gold, Silver, Crude Oil & Platinum with up to 100x leverage.
          </span>
        </div>

        {/* Resources */}
        <div className="flex flex-col gap-2.5 pl-4">
          <span
            className="text-sm font-pixel font-bold uppercase tracking-widest"
            style={{ color: "var(--pixel-yellow)", opacity: 0.85 }}
          >
            Resources
          </span>
          <div className="flex flex-col gap-1.5">
            {[
              { label: "Documentation", href: "#" },
              { label: "GitHub", href: "#" },
              { label: "Bug Bounty", href: "#" },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm font-body transition-colors hover:brightness-150"
                style={{ color: "rgba(255,255,255,0.38)", textDecoration: "none" }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Community */}
        <div className="flex flex-col gap-2.5 pl-4">
          <span
            className="text-sm font-pixel font-bold uppercase tracking-widest"
            style={{ color: "var(--pixel-yellow)", opacity: 0.85 }}
          >
            Community
          </span>
          <div className="flex flex-col gap-1.5">
            {[
              { label: "Discord", href: "#" },
              { label: "Twitter / X", href: "#" },
              { label: "Telegram", href: "#" },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm font-body transition-colors hover:brightness-150"
                style={{ color: "rgba(255,255,255,0.38)", textDecoration: "none" }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

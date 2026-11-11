import { Link } from "react-router-dom";

function SolanaMark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 397.7 311.7" aria-hidden>
      <linearGradient id="buxSolGrad" x1="360.9" y1="351.5" x2="141.2" y2="-69.2" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#00FFA3" />
        <stop offset="1" stopColor="#DC1FFF" />
      </linearGradient>
      <path
        fill="url(#buxSolGrad)"
        d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
      />
    </svg>
  );
}

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={`relative z-10 border-t ${compact ? "py-3" : "py-6"}`}
      style={{ borderColor: "var(--bux-panel-border)" }}
    >
      <div
        className={`mx-auto flex max-w-7xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 ${
          compact ? "text-xs" : "text-sm"
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-display font-semibold text-white">BUX Poker</span>
          <span className="inline-flex items-center gap-1.5 text-[color:var(--bux-text-muted)]">
            <SolanaMark />
            Payouts on Solana
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link to="/tournaments" className="bux-nav-link">
            Tournaments
          </Link>
          <Link to="/leagues" className="bux-nav-link">
            Leagues
          </Link>
          <Link to="/invite" className="bux-nav-link">
            Invite bot
          </Link>
        </nav>
      </div>
    </footer>
  );
}

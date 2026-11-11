import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AddToHomeScreen } from "../components/AddToHomeScreen";

function IconPlay() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 8.5l6 3.5-6 3.5V8.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconTrophy() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 6H5a2 2 0 002 3M17 6h2a2 2 0 01-2 3" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path strokeLinecap="round" d="M3 10h18M16 14.5h2" />
    </svg>
  );
}

function IconBot() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path strokeLinecap="round" d="M12 8V5M9 13h.01M15 13h.01M9 17h6" />
      <circle cx="12" cy="4" r="1" fill="currentColor" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <path strokeLinecap="round" d="M9.5 12.5l1.8 1.8 3.4-3.6" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 17h12l-1.2-1.5A6 6 0 0115 10V9a3 3 0 10-6 0v1a6 6 0 01-1.8 5.5L6 17z" />
      <path strokeLinecap="round" d="M10 17a2 2 0 004 0" />
    </svg>
  );
}

const PLAYER_TILES = [
  {
    title: "Join from Discord",
    body: "Enter tournaments with the Register button in your community — no public signup form on the site.",
    icon: <IconShield />,
  },
  {
    title: "Play live tables",
    body: "Multi-table Hold’em with synced blinds and breaks, in the browser on desktop or phone.",
    icon: <IconPlay />,
  },
  {
    title: "Claim on Solana",
    body: "Paste a wallet for auto-claim (server covers fees), or open a Discord ticket. No wallet connect.",
    icon: <IconWallet />,
  },
] as const;

const COMMUNITY_TILES = [
  {
    title: "Invite the bot",
    body: (
      <>
        Add BUX from{" "}
        <Link to="/invite" className="text-[color:var(--bux-sol-cyan)] hover:underline">
          /invite
        </Link>
        , set your announcement channel, and host when you’re ready.
      </>
    ),
    icon: <IconBot />,
  },
  {
    title: "Members-only events",
    body: "Open registration only to servers you select. Cross-post updates and results to every participating community.",
    icon: <IconBell />,
  },
  {
    title: "Leagues & prizes",
    body: "Run seasons, track standings, and pay winners on Solana without forcing wallet connect.",
    icon: <IconTrophy />,
  },
] as const;

function Tile({
  title,
  body,
  icon,
  className = "",
}: {
  title: string;
  body: ReactNode;
  icon: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bux-home-tile flex h-full min-h-0 items-start gap-3 !p-2.5 sm:!px-3 sm:!py-2.5 ${className}`}>
      <div className="bux-home-tile-icon shrink-0 !h-8 !w-8">{icon}</div>
      <div className="min-w-0">
        <h3 className="font-display text-sm font-bold text-white">{title}</h3>
        <p className="mt-0.5 text-xs leading-snug text-slate-300">{body}</p>
      </div>
    </div>
  );
}

/**
 * Single desktop viewport: brand + art side-by-side, then Players / Communities tile bands.
 * Aces image sits in its own column — never under the tiles.
 */
export function HomePage() {
  return (
    <div className="bux-home relative flex min-h-[calc(100dvh-4rem)] flex-col md:h-[calc(100dvh-4rem)] md:min-h-0 md:overflow-hidden">
      <div className="bux-home-bg absolute inset-0" aria-hidden />
      <div className="bux-home-grid absolute inset-0 opacity-[0.14]" aria-hidden />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col gap-2 px-4 py-3 sm:px-6 lg:gap-2.5 lg:px-8 lg:py-4">
        {/* Hero ~60%: brand + art */}
        <div
          className="grid min-h-0 items-center gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-8"
          style={{ flex: "60 1 0%" }}
        >
          <div className="min-w-0">
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]"
              style={{
                borderColor: "color-mix(in srgb, var(--bux-sol-cyan) 35%, transparent)",
                color: "var(--bux-sol-cyan)",
                background: "color-mix(in srgb, var(--bux-sol-cyan) 8%, transparent)",
              }}
            >
              Discord communities · Solana payouts
            </div>
            <div className="mt-4 flex items-center gap-4">
              <img
                src="/images/bux-poker.png"
                alt="BUX Poker"
                className="h-14 w-14 rounded-xl object-contain sm:h-16 sm:w-16"
              />
              <h1 className="font-display text-5xl font-extrabold tracking-tight text-white sm:text-6xl lg:text-[3.75rem] lg:leading-none">
                BUX Poker
              </h1>
            </div>
            <p className="mt-3 max-w-xl text-base text-slate-300 sm:text-lg">
              Live Hold&apos;em for Discord communities — synced tables, shared blinds, and Solana
              payouts without wallet connect.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                to="/tournaments"
                className="bux-btn-accent rounded-lg px-6 py-2.5 text-sm shadow-lg shadow-emerald-900/40 sm:text-base"
              >
                Browse tournaments
              </Link>
              <Link to="/invite" className="bux-btn-ghost px-6 py-2.5 text-sm sm:text-base">
                Invite the bot
              </Link>
              <AddToHomeScreen />
            </div>
          </div>

          <div className="relative hidden h-full min-h-0 items-center justify-center lg:flex">
            <img
              src="/images/aces.png"
              alt="Ace of hearts, ace of spades, and chips"
              className="max-h-[min(42vh,400px)] w-auto max-w-full object-contain drop-shadow-2xl"
            />
          </div>
        </div>

        {/* Mobile: stacked sections */}
        <div className="flex min-h-0 flex-col gap-4 sm:hidden" style={{ flex: "40 1 0%" }}>
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="bux-section-label">For players</p>
              <Link to="/tournaments" className="bux-nav-link text-xs">
                Find a table →
              </Link>
            </div>
            {PLAYER_TILES.map((tile) => (
              <Tile key={tile.title} {...tile} />
            ))}
          </section>
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="bux-section-label">For communities</p>
              <Link to="/invite" className="bux-nav-link text-xs">
                Add the bot →
              </Link>
            </div>
            {COMMUNITY_TILES.map((tile) => (
              <Tile key={tile.title} {...tile} />
            ))}
          </section>
        </div>

        {/* Desktop: one grid — paired rows share height */}
        <div
          className="hidden min-h-0 gap-x-6 gap-y-2 sm:grid sm:grid-cols-2"
          style={{ flex: "40 1 0%", gridTemplateRows: "auto repeat(3, minmax(0, 1fr))" }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="bux-section-label">For players</p>
            <Link to="/tournaments" className="bux-nav-link text-xs">
              Find a table →
            </Link>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="bux-section-label">For communities</p>
            <Link to="/invite" className="bux-nav-link text-xs">
              Add the bot →
            </Link>
          </div>

          {PLAYER_TILES.map((playerTile, i) => (
            <Fragment key={playerTile.title}>
              <Tile {...playerTile} />
              <Tile {...COMMUNITY_TILES[i]} />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

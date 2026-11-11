import { Link } from "react-router-dom";
import { AddToHomeScreen } from "../components/AddToHomeScreen";
import { SiteFooter } from "../components/SiteFooter";

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

function IconWallet() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path strokeLinecap="round" d="M3 10h18M16 14.5h2" />
    </svg>
  );
}

const TILES = [
  {
    title: "Invite & host",
    body: (
      <>
        Add the bot from{" "}
        <Link to="/invite" className="text-[color:var(--bux-sol-cyan)] hover:underline">
          /invite
        </Link>
        , then run tournaments and open registration on the servers you choose.
      </>
    ),
    icon: <IconBot />,
  },
  {
    title: "Members only",
    body: "Players register with the Discord Register button — server members only, not via a public site form.",
    icon: <IconShield />,
  },
  {
    title: "Announcements",
    body: "Starts, updates, and results post to every participating community automatically.",
    icon: <IconBell />,
  },
  {
    title: "Solana payouts",
    body: "Claim by ticket in Discord, or paste a wallet for auto-claim — the server covers fees, no wallet connect.",
    icon: <IconWallet />,
  },
] as const;

/**
 * Single-viewport desktop home: brand hero, full-width feature tiles, compact footer.
 * Solana cyan/violet accents on BUX ink — not a purple-on-white template look.
 */
export function HomePage() {
  return (
    <div className="bux-home relative flex min-h-[calc(100dvh-4rem)] flex-col md:h-[calc(100dvh-4rem)] md:min-h-0 md:overflow-hidden">
      <div className="bux-home-bg absolute inset-0" aria-hidden />
      <div className="bux-home-grid absolute inset-0 opacity-[0.18]" aria-hidden />
      <img
        src="/images/aces.png"
        alt=""
        className="pointer-events-none absolute -right-6 bottom-0 top-0 hidden h-full w-[42%] object-contain object-right opacity-70 lg:block"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-between gap-5 px-4 py-5 sm:px-6 lg:gap-6 lg:px-8 lg:py-6">
        <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{
                borderColor: "color-mix(in srgb, var(--bux-sol-cyan) 35%, transparent)",
                color: "var(--bux-sol-cyan)",
                background: "color-mix(in srgb, var(--bux-sol-cyan) 8%, transparent)",
              }}
            >
              Built for Discord · Payouts on Solana
            </div>
            <img
              src="/images/bux-poker.png"
              alt="BUX Poker"
              className="mt-4 h-14 w-14 rounded-xl object-contain sm:h-16 sm:w-16"
            />
            <h1 className="font-display mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-[3.4rem] lg:leading-[0.95]">
              BUX Poker
            </h1>
            <p className="mt-3 max-w-md text-sm text-slate-300 sm:text-base">
              Live Hold&apos;em for Discord communities — synced tables, shared blinds, and Solana
              payouts without wallet connect.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link to="/tournaments" className="bux-btn-accent rounded-lg px-5 py-2.5 text-sm shadow-lg shadow-emerald-900/40">
                Browse tournaments
              </Link>
              <Link to="/invite" className="bux-btn-ghost px-5 py-2.5 text-sm">
                Invite the bot
              </Link>
              <AddToHomeScreen />
            </div>
          </div>

          <div className="hidden lg:block" aria-hidden />
        </div>

        <div>
          <p className="bux-section-label mb-3">How it works</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TILES.map((tile) => (
              <div key={tile.title} className="bux-home-tile">
                <div className="bux-home-tile-icon">{tile.icon}</div>
                <h2 className="font-display mt-3 text-base font-bold text-white">{tile.title}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300 sm:text-[13px]">{tile.body}</p>
              </div>
            ))}
          </div>
        </div>

        <SiteFooter compact />
      </div>
    </div>
  );
}

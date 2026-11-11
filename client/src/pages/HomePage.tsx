import { Link } from "react-router-dom";
import { AddToHomeScreen } from "../components/AddToHomeScreen";

/**
 * Marketing home — single viewport on desktop; compact Discord story beside the brand.
 */
export function HomePage() {
  return (
    <div className="bux-page relative flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden md:h-[calc(100dvh-4rem)] md:min-h-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 72% 38%, rgba(10,61,46,0.58), transparent 56%), linear-gradient(155deg, var(--bux-ink) 0%, var(--bux-ink-elevated) 52%, var(--bux-felt-deep) 130%)",
        }}
      />
      <img
        src="/images/aces.png"
        alt=""
        className="pointer-events-none absolute inset-y-0 right-0 h-full w-[58%] object-contain object-right opacity-85 sm:w-[50%] lg:w-[46%]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center gap-7 px-4 py-8 sm:px-6 lg:gap-8 lg:px-8 lg:py-6">
        <div className="max-w-xl">
          <img
            src="/images/bux-poker.png"
            alt="BUX Poker"
            className="h-14 w-14 rounded-xl object-contain sm:h-16 sm:w-16"
          />
          <h1 className="font-display mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-[3.25rem] lg:leading-none">
            BUX Poker
          </h1>
          <p className="mt-3 max-w-md text-sm text-slate-300 sm:text-base">
            Live Hold&apos;em for Discord communities — synced tables, shared blinds, payouts without
            wallet connect.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link to="/tournaments" className="bux-btn-accent rounded-lg px-5 py-2.5 text-sm shadow-lg">
              Browse tournaments
            </Link>
            <Link to="/invite" className="bux-btn-ghost px-5 py-2.5 text-sm">
              Invite the bot
            </Link>
            <Link to="/leagues" className="bux-nav-link text-sm">
              Leagues
            </Link>
            <AddToHomeScreen />
          </div>
        </div>

        <div className="max-w-2xl">
          <p className="bux-section-label mb-3">Discord communities</p>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <p className="text-sm leading-snug text-slate-300">
              <span className="font-display font-semibold text-white">Invite &amp; host.</span>{" "}
              Add the bot from{" "}
              <Link to="/invite" className="text-[color:var(--bux-brass-bright)] hover:underline">
                /invite
              </Link>
              , then run tournaments and open registration on the servers you choose.
            </p>
            <p className="text-sm leading-snug text-slate-300">
              <span className="font-display font-semibold text-white">Members only.</span> Players
              register with the Discord Register button — server members only, not via a public site
              form.
            </p>
            <p className="text-sm leading-snug text-slate-300">
              <span className="font-display font-semibold text-white">Announcements.</span> Starts,
              updates, and results post to every participating community automatically.
            </p>
            <p className="text-sm leading-snug text-slate-300">
              <span className="font-display font-semibold text-white">Payouts.</span> Claim by ticket
              in Discord, or paste a wallet for auto-claim — the server covers fees, no wallet
              connect.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

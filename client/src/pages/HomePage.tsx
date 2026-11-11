import { Link } from "react-router-dom";
import { AddToHomeScreen } from "../components/AddToHomeScreen";

/**
 * Marketing home — first viewport is brand-only; Discord/community details sit below.
 */
export function HomePage() {
  return (
    <div className="bux-page flex flex-col">
      {/* First viewport: brand, one line, CTAs, full-bleed hero art */}
      <section className="relative flex min-h-[calc(100dvh-4rem)] flex-col justify-end overflow-hidden sm:justify-center">
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
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-[62%] object-contain object-right opacity-90 sm:w-[54%]"
        />
        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-12 pt-10 sm:px-6 sm:pb-16 lg:px-8">
          <img
            src="/images/bux-poker.png"
            alt="BUX Poker"
            className="h-16 w-16 rounded-xl object-contain sm:h-20 sm:w-20"
          />
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl">
            BUX Poker
          </h1>
          <p className="max-w-md text-base text-slate-300 sm:text-lg">
            Live Hold&apos;em tournaments for Discord communities — synced tables, shared blinds, and
            payouts without wallet connect.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/tournaments" className="bux-btn-accent rounded-lg px-6 py-3 text-sm shadow-lg">
              Browse tournaments
            </Link>
            <Link to="/invite" className="bux-btn-ghost px-6 py-3 text-sm">
              Invite the bot
            </Link>
            <AddToHomeScreen />
          </div>
        </div>
      </section>

      {/* Discord communities */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--bux-panel-border)",
          background: "color-mix(in srgb, var(--bux-ink-elevated) 55%, transparent)",
        }}
      >
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="bux-section-label mb-3">For Discord communities</p>
          <h2 className="font-display max-w-2xl text-2xl font-bold text-white sm:text-3xl">
            Run tournaments where your community already lives
          </h2>
          <p className="bux-muted mt-3 max-w-2xl text-sm sm:text-base">
            Bring the BUX Poker bot into your server, open registration to members you choose, and
            keep every update on Discord while the cards play in the browser.
          </p>

          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">Invite &amp; host</h3>
              <p className="bux-muted mt-2 text-sm leading-relaxed">
                Communities on Discord can add the bot from the{" "}
                <Link to="/invite" className="text-[color:var(--bux-brass-bright)] hover:underline">
                  /invite
                </Link>{" "}
                page. Once it&apos;s in your server, you can host tournaments and turn on registration
                for that community — or for other project servers you select.
              </p>
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-white">Members-only signup</h3>
              <p className="bux-muted mt-2 text-sm leading-relaxed">
                Registration is fully Discord-native. Players join from the Register button in your
                server — only members of that community can enter. There is no open signup form on
                the website.
              </p>
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-white">Shared announcements</h3>
              <p className="bux-muted mt-2 text-sm leading-relaxed">
                When a tournament starts, advances, or finishes, BUX posts the news to every
                participating community so results and schedule updates stay visible where people
                already chat.
              </p>
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-white">Simple payouts</h3>
              <p className="bux-muted mt-2 text-sm leading-relaxed">
                Winners can claim by opening a ticket in the chosen Discord server, or use automatic
                claim: paste a wallet address and the server covers the network fee. No wallet
                connect required.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/invite" className="bux-btn-accent rounded-lg px-5 py-2.5 text-sm">
              Add bot to Discord
            </Link>
            <Link to="/leagues" className="bux-btn-ghost px-5 py-2.5 text-sm">
              View leagues
            </Link>
          </div>
        </div>
      </section>

      {/* Play paths */}
      <section className="border-t" style={{ borderColor: "var(--bux-panel-border)" }}>
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="bux-section-label mb-6">Play</p>
          <div className="grid gap-8 sm:grid-cols-2">
            <Link to="/tournaments" className="group block py-1">
              <h2 className="font-display text-xl font-bold text-white transition-colors group-hover:text-[color:var(--bux-brass-bright)]">
                Tournaments
              </h2>
              <p className="bux-muted mt-1 text-sm">
                Multi-table Hold&apos;em with synced blinds, breaks, and prizes across your Discord
                servers.
              </p>
            </Link>
            <Link to="/leagues" className="group block py-1">
              <h2 className="font-display text-xl font-bold text-white transition-colors group-hover:text-[color:var(--bux-brass-bright)]">
                Leagues
              </h2>
              <p className="bux-muted mt-1 text-sm">
                Season standings that track your community across a run of events.
              </p>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

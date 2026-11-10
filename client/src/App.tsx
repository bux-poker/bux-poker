import { useState } from "react";
import { Route, Routes, Link, Navigate, useLocation } from "react-router-dom";
import { TournamentList } from "./components/tournament/TournamentList";
import { TournamentDetail } from "./components/tournament/TournamentDetail";
import { PokerGameView } from "./features/game/PokerGameView";
import { LoginButton } from "./components/auth/LoginButton";
import { CreateTournament } from "./components/admin/CreateTournament";
import { AdminRoute } from "./components/admin/AdminRoute";
import { AuthCallback } from "./pages/AuthCallback";
import { BotInvitePage } from "./pages/BotInvitePage";
import { TableTestPage } from "./pages/TableTestPage";
import { useAdmin } from "./hooks/useAdmin";
import { useAutoJoinActiveTable } from "./hooks/useAutoJoinActiveTable";
import { AddToHomeScreen } from "./components/AddToHomeScreen";
import { LeagueListPage } from "./pages/LeagueListPage";
import { LeagueDetailPage } from "./pages/LeagueDetailPage";
import { LoginPage } from "./pages/LoginPage";

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAdmin, loading: adminLoading } = useAdmin();
  const location = useLocation();
  const isGameRoute = location.pathname.startsWith('/game/') || location.pathname === '/table-test';
  useAutoJoinActiveTable();

  return (
    <div
      className={`min-h-screen text-slate-50 ${isGameRoute ? "flex min-h-[100dvh] flex-col" : ""}`}
      style={{ background: "var(--bux-ink, #0b0f14)" }}
    >
      {!isGameRoute && (
      <header
        className="sticky top-0 z-50 border-b backdrop-blur-sm"
        style={{
          borderColor: "var(--bux-panel-border)",
          background: "color-mix(in srgb, var(--bux-ink) 88%, transparent)",
        }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/" className="flex items-center gap-3">
              <img
                src="/images/bux-poker.png"
                alt="BUX Poker Logo"
                className="h-10 w-10 rounded-lg object-contain"
              />
              <div className="flex flex-col">
                <span className="font-display text-lg font-bold tracking-tight text-white">
                  BUX Poker
                </span>
                <span className="text-[10px]" style={{ color: "var(--bux-brass)" }}>
                  Community tournaments
                </span>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden items-center gap-6 md:flex">
              <Link
                to="/tournaments"
                className="text-sm font-medium text-slate-300 transition-colors hover:text-emerald-400"
              >
                Tournaments
              </Link>
              <Link
                to="/leagues"
                className="text-sm font-medium text-slate-300 transition-colors hover:text-emerald-400"
              >
                Leagues
              </Link>
              {!adminLoading && isAdmin && (
                <>
                  <Link
                    to="/table-test"
                    className="text-sm font-medium text-slate-300 transition-colors hover:text-emerald-400"
                  >
                    Table test
                  </Link>
                  <Link
                    to="/admin"
                    className="text-sm font-medium text-slate-300 transition-colors hover:text-emerald-400"
                  >
                    Admin
                  </Link>
                </>
              )}
              <LoginButton />
            </nav>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white md:hidden"
              aria-label="Toggle menu"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                {mobileMenuOpen ? (
                  <path d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <div className="border-t border-slate-800 py-4 md:hidden">
              <nav className="flex flex-col gap-4">
                <Link
                  to="/tournaments"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-emerald-400"
                >
                  Tournaments
                </Link>
                <Link
                  to="/leagues"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-emerald-400"
                >
                  Leagues
                </Link>
                {!adminLoading && isAdmin && (
                  <>
                    <Link
                      to="/table-test"
                      onClick={() => setMobileMenuOpen(false)}
                      className="px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-emerald-400"
                    >
                      Table test
                    </Link>
                    <Link
                      to="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className="px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-emerald-400"
                    >
                      Admin
                    </Link>
                  </>
                )}
                <div className="px-4">
                  <LoginButton />
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>
      )}

      <main className={isGameRoute ? "flex-1" : "mx-auto max-w-7xl flex-1 px-4 sm:px-6 lg:px-8"}>
        <Routes>
          <Route
            path="/"
            element={
              <div className="flex flex-col">
                {/* First viewport: brand hero only */}
                <section className="relative flex min-h-[calc(100vh-4rem)] flex-col justify-end overflow-hidden sm:justify-center">
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(ellipse at 70% 40%, rgba(10,61,46,0.55), transparent 55%), linear-gradient(160deg, #0b0f14 0%, #121820 55%, #0a3d2e 140%)",
                    }}
                  />
                  <img
                    src="/images/aces.png"
                    alt=""
                    className="pointer-events-none absolute inset-y-0 right-0 h-full w-[58%] object-contain object-right opacity-90 sm:w-[52%]"
                  />
                  <div className="relative z-10 flex max-w-xl flex-col gap-5 px-1 pb-10 pt-8 sm:pb-16">
                    <img
                      src="/images/bux-poker.png"
                      alt="BUX Poker"
                      className="h-16 w-16 rounded-xl object-contain sm:h-20 sm:w-20"
                    />
                    <h1 className="font-display text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl">
                      BUX Poker
                    </h1>
                    <p className="max-w-md text-base text-slate-300 sm:text-lg">
                      Community Texas Hold&apos;em tournaments — live tables, synced blinds, Discord login.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        to="/tournaments"
                        className="bux-btn-accent rounded-lg px-6 py-3 text-sm font-semibold shadow-lg"
                      >
                        Browse tournaments
                      </Link>
                      <Link
                        to="/leagues"
                        className="rounded-lg border px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5"
                        style={{ borderColor: "var(--bux-panel-border)" }}
                      >
                        View leagues
                      </Link>
                      <AddToHomeScreen />
                    </div>
                  </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: "var(--bux-panel-border)" }}>
                  <p className="mb-4 font-display text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--bux-brass)" }}>
                    Play
                  </p>
                  <div className="flex flex-col gap-4 sm:flex-row">
                    <Link
                      to="/tournaments"
                      className="flex-1 py-2 text-left transition-colors hover:text-emerald-300"
                    >
                      <h2 className="font-display text-xl font-bold text-white">Tournaments</h2>
                      <p className="mt-1 text-sm text-slate-400">
                        Multi-table Hold&apos;em with blinds, breaks, and prizes.
                      </p>
                    </Link>
                    <Link
                      to="/leagues"
                      className="flex-1 py-2 text-left transition-colors hover:text-emerald-300"
                    >
                      <h2 className="font-display text-xl font-bold text-white">Leagues</h2>
                      <p className="mt-1 text-sm text-slate-400">
                        Season standings across your communities.
                      </p>
                    </Link>
                  </div>
                </section>
              </div>
            }
          />
          <Route path="/tournaments" element={<TournamentList />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/game/:id" element={<PokerGameView />} />
          <Route path="/table-test" element={<TableTestPage />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <CreateTournament />
              </AdminRoute>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/invite" element={<BotInvitePage />} />
          <Route path="/bot-invite" element={<Navigate to="/invite" replace />} />
          <Route path="/discord-bot" element={<Navigate to="/invite" replace />} />
          <Route path="/leagues" element={<LeagueListPage />} />
          <Route path="/leagues/:id" element={<LeagueDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;


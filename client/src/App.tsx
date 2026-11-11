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
import { LeagueListPage } from "./pages/LeagueListPage";
import { LeagueDetailPage } from "./pages/LeagueDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAdmin, loading: adminLoading } = useAdmin();
  const location = useLocation();
  const isGameRoute = location.pathname.startsWith('/game/') || location.pathname === '/table-test';
  const isHomeRoute = location.pathname === "/";
  useAutoJoinActiveTable();

  return (
    <div
      className={`bux-page min-h-screen ${isGameRoute ? "flex min-h-[100dvh] flex-col" : ""}`}
      style={{ background: "var(--bux-ink, #1e2733)" }}
    >
      {!isGameRoute && (
      <header
        className="sticky top-0 z-50 border-b backdrop-blur-sm"
        style={{
          borderColor: "var(--bux-panel-border)",
          background: "color-mix(in srgb, var(--bux-ink) 90%, transparent)",
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

            <nav className="hidden items-center gap-6 md:flex">
              <Link to="/tournaments" className="bux-nav-link">
                Tournaments
              </Link>
              <Link to="/leagues" className="bux-nav-link">
                Leagues
              </Link>
              <Link to="/invite" className="bux-nav-link">
                Invite bot
              </Link>
              {!adminLoading && isAdmin && (
                <>
                  <Link to="/table-test" className="bux-nav-link">
                    Table test
                  </Link>
                  <Link to="/admin" className="bux-nav-link">
                    Admin
                  </Link>
                </>
              )}
              <LoginButton />
            </nav>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-lg p-2 text-[color:var(--bux-text-muted)] transition-colors hover:bg-[color:var(--bux-panel)] hover:text-white md:hidden"
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

          {mobileMenuOpen && (
            <div className="border-t py-4 md:hidden" style={{ borderColor: "var(--bux-panel-border)" }}>
              <nav className="flex flex-col gap-1">
                <Link
                  to="/tournaments"
                  onClick={() => setMobileMenuOpen(false)}
                  className="bux-nav-link rounded-lg px-4 py-2 hover:bg-[color:var(--bux-panel)]"
                >
                  Tournaments
                </Link>
                <Link
                  to="/leagues"
                  onClick={() => setMobileMenuOpen(false)}
                  className="bux-nav-link rounded-lg px-4 py-2 hover:bg-[color:var(--bux-panel)]"
                >
                  Leagues
                </Link>
                <Link
                  to="/invite"
                  onClick={() => setMobileMenuOpen(false)}
                  className="bux-nav-link rounded-lg px-4 py-2 hover:bg-[color:var(--bux-panel)]"
                >
                  Invite bot
                </Link>
                {!adminLoading && isAdmin && (
                  <>
                    <Link
                      to="/table-test"
                      onClick={() => setMobileMenuOpen(false)}
                      className="bux-nav-link rounded-lg px-4 py-2 hover:bg-[color:var(--bux-panel)]"
                    >
                      Table test
                    </Link>
                    <Link
                      to="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className="bux-nav-link rounded-lg px-4 py-2 hover:bg-[color:var(--bux-panel)]"
                    >
                      Admin
                    </Link>
                  </>
                )}
                <div className="px-4 pt-2">
                  <LoginButton />
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>
      )}

      <main
        className={
          isGameRoute
            ? "flex-1"
            : isHomeRoute
              ? "flex-1"
              : "mx-auto max-w-7xl flex-1 px-4 sm:px-6 lg:px-8"
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
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


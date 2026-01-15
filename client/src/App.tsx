import { useState } from "react";
import { Route, Routes, Link } from "react-router-dom";
import { TournamentList } from "./components/tournament/TournamentList";
import { TournamentDetail } from "./components/tournament/TournamentDetail";
import { PokerGameView } from "./features/game/PokerGameView";
import { LoginButton } from "./components/auth/LoginButton";
import { CreateTournament } from "./components/admin/CreateTournament";
import { AuthCallback } from "./pages/AuthCallback";

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600">
                <span className="text-xl">🃏</span>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold tracking-tight text-white">
                  BUX Poker
                </span>
                <span className="text-[10px] text-emerald-400">Tournament Platform</span>
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
              <Link
                to="/admin"
                className="text-sm font-medium text-slate-300 transition-colors hover:text-emerald-400"
              >
                Admin
              </Link>
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
                <Link
                  to="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-emerald-400"
                >
                  Admin
                </Link>
                <div className="px-4">
                  <LoginButton />
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
        <Routes>
          <Route
            path="/"
            element={
              <div className="flex min-h-[calc(100vh-4rem)] flex-col justify-center py-4 lg:min-h-[calc(100vh-5rem)] lg:py-8">
                <div className="flex flex-col gap-6 lg:gap-8">
                  {/* Hero Section - Full Width */}
                  <div className="relative flex overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-900/20 via-slate-900/50 to-teal-900/20">
                    <div className="flex w-full flex-row items-center">
                      {/* Text Content */}
                      <div className="relative z-10 flex-1 p-4 sm:p-6 md:p-8 lg:p-10">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 sm:px-3 sm:py-1.5 sm:text-xs md:px-4 md:py-2 md:text-sm">
                          <span>🃏</span>
                          <span className="whitespace-nowrap">Community Poker Platform</span>
                        </div>
                        <h1 className="mb-2 text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl lg:text-5xl">
                          Welcome to{" "}
                          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                            BUX Poker
                          </span>
                        </h1>
                        <p className="mb-4 text-sm text-slate-300 sm:text-base md:text-lg">
                          Experience the thrill of Texas Hold'em tournaments with
                          Discord integration, real-time gameplay, and competitive
                          league systems.
                        </p>
                        <div className="flex flex-wrap gap-2 sm:gap-3">
                          <Link
                            to="/tournaments"
                            className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-500/25 transition-all hover:scale-105 hover:shadow-emerald-500/40 sm:px-5 sm:py-2.5 sm:text-sm md:px-6 md:py-3 md:text-base"
                          >
                            Browse Tournaments
                          </Link>
                          <Link
                            to="/leagues"
                            className="rounded-lg border-2 border-slate-700 bg-slate-800/50 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm transition-all hover:border-emerald-500/50 hover:bg-slate-800 sm:px-5 sm:py-2.5 sm:text-sm md:px-6 md:py-3 md:text-base"
                          >
                            View Leagues
                          </Link>
                        </div>
                      </div>
                      {/* Aces Image */}
                      <div className="relative flex h-full min-h-[200px] w-1/3 flex-shrink-0 items-center justify-center sm:min-h-[250px] md:w-2/5 lg:w-1/2">
                        <img
                          src="/images/aces.png"
                          alt="Aces"
                          className="h-full w-full object-contain object-center"
                        />
                      </div>
                    </div>
                    {/* Decorative elements */}
                    <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl lg:-right-20 lg:-top-20 lg:h-64 lg:w-64"></div>
                    <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-teal-500/10 blur-3xl lg:-bottom-20 lg:-left-20 lg:h-64 lg:w-64"></div>
                  </div>

                  {/* Features Grid */}
                  <div className="flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
                      <Link
                        to="/tournaments"
                        className="group relative overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/50 to-slate-800/30 p-5 transition-all hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/10"
                      >
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 sm:h-12 sm:w-12">
                          <svg
                            className="h-5 w-5 text-emerald-400 sm:h-6 sm:w-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                            />
                          </svg>
                        </div>
                        <h2 className="mb-1.5 text-lg font-bold text-white sm:text-xl">
                          Tournaments
                        </h2>
                        <p className="mb-3 text-xs text-slate-400 sm:text-sm">
                          Join multi-table Texas Hold'em tournaments with real-time
                          gameplay, blind structures, and prize pools.
                        </p>
                        <div className="flex items-center text-xs font-medium text-emerald-400 group-hover:gap-2 sm:text-sm">
                          <span>Explore</span>
                          <svg
                            className="h-3 w-3 transition-transform group-hover:translate-x-1 sm:h-4 sm:w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      </Link>

                      <Link
                        to="/leagues"
                        className="group relative overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/50 to-slate-800/30 p-5 transition-all hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/10"
                      >
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500/20 to-teal-600/20 sm:h-12 sm:w-12">
                          <svg
                            className="h-5 w-5 text-teal-400 sm:h-6 sm:w-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                            />
                          </svg>
                        </div>
                        <h2 className="mb-1.5 text-lg font-bold text-white sm:text-xl">
                          Leagues
                        </h2>
                        <p className="mb-3 text-xs text-slate-400 sm:text-sm">
                          Compete in monthly leagues, climb the leaderboard, and
                          earn your place among the elite players.
                        </p>
                        <div className="flex items-center text-xs font-medium text-teal-400 group-hover:gap-2 sm:text-sm">
                          <span>View Rankings</span>
                          <svg
                            className="h-3 w-3 transition-transform group-hover:translate-x-1 sm:h-4 sm:w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      </Link>
                    </div>

                    <div className="group relative w-full overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/50 to-slate-800/30 p-5 transition-all hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/10 sm:p-6">
                      <div className="flex items-start gap-4 sm:items-center">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500/20 to-purple-600/20 sm:h-12 sm:w-12">
                          <svg
                            className="h-5 w-5 text-purple-400 sm:h-6 sm:w-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                            />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h2 className="mb-1.5 text-lg font-bold text-white sm:text-xl">
                            Discord Integration
                          </h2>
                          <p className="mb-3 text-xs text-slate-400 sm:text-sm">
                            Seamlessly connect with Discord for authentication, bot
                            commands, and community features.
                          </p>
                          <div className="flex items-center gap-2 text-xs font-medium text-purple-400 sm:text-sm">
                            <span>Connected</span>
                            <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            }
          />
          <Route path="/tournaments" element={<TournamentList />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/game/:id" element={<PokerGameView />} />
          <Route path="/admin" element={<CreateTournament />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/leagues"
            element={
              <div className="space-y-4">
                <h1 className="text-2xl font-semibold">Leagues</h1>
                <p className="text-slate-400">League list coming soon</p>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

export default App;


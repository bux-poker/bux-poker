import { Route, Routes, Link } from "react-router-dom";
import { TournamentList } from "./components/tournament/TournamentList";
import { TournamentDetail } from "./components/tournament/TournamentDetail";
import { PokerGameView } from "./features/game/PokerGameView";

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">
              BUX Poker
            </span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
              Tournament Platform
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/tournaments"
              className="text-sm text-slate-400 transition-colors hover:text-slate-200"
            >
              Tournaments
            </Link>
            <Link
              to="/leagues"
              className="text-sm text-slate-400 transition-colors hover:text-slate-200"
            >
              Leagues
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        <Routes>
          <Route
            path="/"
            element={
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">
                    Welcome to BUX Poker
                  </h1>
                  <p className="mt-2 max-w-2xl text-slate-300">
                    Texas Hold'em tournament platform with Discord integration
                    and league system.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Link
                    to="/tournaments"
                    className="rounded-lg border border-slate-800 bg-slate-900/50 p-6 transition-all hover:border-emerald-500/50"
                  >
                    <h2 className="text-xl font-semibold text-slate-100">
                      Tournaments
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                      Join multi-table Texas Hold'em tournaments
                    </p>
                  </Link>
                  <Link
                    to="/leagues"
                    className="rounded-lg border border-slate-800 bg-slate-900/50 p-6 transition-all hover:border-emerald-500/50"
                  >
                    <h2 className="text-xl font-semibold text-slate-100">
                      Leagues
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                      Compete in monthly leagues and climb the leaderboard
                    </p>
                  </Link>
                </div>
              </div>
            }
          />
          <Route path="/tournaments" element={<TournamentList />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/game/:id" element={<PokerGameView />} />
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


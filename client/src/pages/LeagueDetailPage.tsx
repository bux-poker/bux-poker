import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';

type Tab = 'table' | 'next' | 'schedule' | 'completed';

interface StandingRow {
  id: string;
  points: number;
  gamesPlayed: number;
  bestFinish: number | null;
  user: { id: string; username: string; avatarUrl: string | null };
}

interface GameRow {
  id: string;
  gameNumber: number;
  tournament: {
    id: string;
    name: string;
    startTime: string;
    status: string;
  };
}

interface LeagueDetail {
  id: string;
  name: string;
  description: string | null;
  timezone: string | null;
  totalGames: number;
  status: string;
  standings: StandingRow[];
  games: GameRow[];
}

export function LeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('table');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<LeagueDetail>(`/api/leagues/${id}`);
        if (!cancelled) setLeague(data);
      } catch {
        if (!cancelled) setError('League not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const { nextGame, completedGames, scheduleGames } = useMemo(() => {
    if (!league?.games) {
      return {
        nextGame: null as GameRow | null,
        completedGames: [] as GameRow[],
        scheduleGames: [] as GameRow[],
      };
    }
    const sorted = [...league.games].sort(
      (a, b) => new Date(a.tournament.startTime).getTime() - new Date(b.tournament.startTime).getTime()
    );
    const completed = sorted.filter(
      (g) => g.tournament.status === 'COMPLETED' || g.tournament.status === 'CANCELLED'
    );
    const next = sorted.find(
      (g) => g.tournament.status !== 'COMPLETED' && g.tournament.status !== 'CANCELLED'
    );
    return {
      nextGame: next ?? null,
      completedGames: completed,
      scheduleGames: sorted,
    };
  }, [league]);

  if (loading) return <p className="py-8 text-slate-400">Loading…</p>;
  if (error || !league) return <p className="py-8 text-red-400">{error || 'Not found'}</p>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'table', label: 'League table' },
    { key: 'next', label: 'Next game' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'completed', label: 'Completed games' },
  ];

  return (
    <div className="space-y-6 py-6">
      <div>
        <Link to="/leagues" className="text-sm text-emerald-400 hover:underline">
          ← Leagues
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">{league.name}</h1>
        {league.description && <p className="mt-1 text-slate-400">{league.description}</p>}
        {league.timezone && (
          <p className="mt-1 text-xs text-slate-500">Creator timezone: {league.timezone}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'table' && (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm text-slate-200">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-400">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Points</th>
                <th className="px-4 py-3">Games</th>
                <th className="px-4 py-3">Best finish</th>
              </tr>
            </thead>
            <tbody>
              {league.standings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No points yet.
                  </td>
                </tr>
              ) : (
                league.standings.map((row, i) => (
                  <tr key={row.id} className="border-b border-slate-800/80">
                    <td className="px-4 py-2">{i + 1}</td>
                    <td className="px-4 py-2 font-medium">{row.user.username}</td>
                    <td className="px-4 py-2">{row.points}</td>
                    <td className="px-4 py-2">{row.gamesPlayed}</td>
                    <td className="px-4 py-2">
                      {row.bestFinish != null ? row.bestFinish : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'next' && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          {nextGame ? (
            <>
              <p className="text-slate-300">
                Game <strong>{nextGame.gameNumber}</strong> / {league.totalGames}:{' '}
                {nextGame.tournament.name}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Starts: {new Date(nextGame.tournament.startTime).toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-slate-500">Status: {nextGame.tournament.status}</p>
              <Link
                to={`/tournaments/${nextGame.tournament.id}`}
                className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Open tournament lobby
              </Link>
            </>
          ) : (
            <p className="text-slate-400">No upcoming leg — season may be complete.</p>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <ul className="space-y-2">
          {scheduleGames.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3"
            >
              <span className="text-slate-200">
                Game {g.gameNumber}: {g.tournament.name}
              </span>
              <span className="text-sm text-slate-400">
                {new Date(g.tournament.startTime).toLocaleString()}
              </span>
              <span className="text-xs text-slate-500">{g.tournament.status}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'completed' && (
        <ul className="space-y-2">
          {completedGames.length === 0 ? (
            <p className="text-slate-500">No completed or cancelled legs yet.</p>
          ) : (
            completedGames.map((g) => (
              <li key={g.id}>
                <Link
                  to={`/tournaments/${g.tournament.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 transition-colors hover:border-emerald-500/30"
                >
                  <span>
                    Game {g.gameNumber}: {g.tournament.name}
                  </span>
                  <span className="text-sm text-slate-400">{g.tournament.status}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

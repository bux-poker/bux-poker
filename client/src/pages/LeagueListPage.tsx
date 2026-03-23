import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

interface LeagueRow {
  id: string;
  name: string;
  description: string | null;
  totalGames: number;
  status: string;
  month?: number;
  year?: number;
}

export function LeagueListPage() {
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<LeagueRow[]>('/api/leagues');
        if (!cancelled) setLeagues(Array.isArray(data) ? data : []);
      } catch (e: unknown) {
        if (!cancelled) setError('Failed to load leagues');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-slate-400">Loading leagues…</p>;
  }
  if (error) {
    return <p className="text-red-400">{error}</p>;
  }

  return (
    <div className="space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Leagues</h1>
        <p className="mt-1 text-sm text-slate-400">
          Ongoing and recently completed leagues — table, schedule, and links to each leg.
        </p>
      </div>
      {leagues.length === 0 ? (
        <p className="text-slate-400">No leagues to show right now.</p>
      ) : (
        <ul className="space-y-3">
          {leagues.map((L) => (
            <li key={L.id}>
              <Link
                to={`/leagues/${L.id}`}
                className="block rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:border-emerald-500/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{L.name}</span>
                  {L.status === 'COMPLETED' && (
                    <span className="rounded bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-200">
                      Completed
                    </span>
                  )}
                </div>
                {L.description && (
                  <p className="mt-1 text-sm text-slate-400 line-clamp-2">{L.description}</p>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  {L.totalGames} games
                  {L.month != null && L.year != null && (
                    <span className="text-slate-600">
                      {' '}
                      · {new Date(L.year, L.month - 1).toLocaleString(undefined, {
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAdmin } from '../hooks/useAdmin';

interface LeagueRow {
  id: string;
  name: string;
  description: string | null;
  totalGames: number;
  status: string;
  month?: number;
  year?: number;
  canCancel?: boolean;
  canDelete?: boolean;
}

export function LeagueListPage() {
  const { isAdmin, loading: adminLoading } = useAdmin();
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadLeagues = useCallback(async () => {
    const url = isAdmin ? '/api/admin/leagues' : '/api/leagues';
    const token = localStorage.getItem('sessionToken');
    const headers =
      isAdmin && token ? { Authorization: `Bearer ${token}` } : undefined;
    const { data } = await api.get<LeagueRow[]>(url, headers ? { headers } : undefined);
    setLeagues(Array.isArray(data) ? data : []);
  }, [isAdmin]);

  useEffect(() => {
    if (adminLoading) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await loadLeagues();
        if (!cancelled) setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError('Failed to load leagues');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminLoading, isAdmin, loadLeagues]);

  const handleCancel = async (L: LeagueRow) => {
    if (!L.canCancel) return;
    if (
      !confirm(
        `Cancel league "${L.name}"? All scheduled legs will be marked cancelled. This cannot be undone (use Delete to remove entirely).`
      )
    ) {
      return;
    }
    const token = localStorage.getItem('sessionToken');
    if (!token) {
      alert('Not authenticated');
      return;
    }
    setCancellingId(L.id);
    try {
      await api.patch(`/api/admin/leagues/${L.id}/cancel`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadLeagues();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      alert(msg || 'Failed to cancel league');
    } finally {
      setCancellingId(null);
    }
  };

  const handleDelete = async (L: LeagueRow) => {
    if (!L.canDelete) return;
    if (
      !confirm(
        `PERMANENTLY DELETE league "${L.name}" and all leg tournaments?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    const token = localStorage.getItem('sessionToken');
    if (!token) {
      alert('Not authenticated');
      return;
    }
    setDeletingId(L.id);
    try {
      await api.delete(`/api/admin/leagues/${L.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadLeagues();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      alert(msg || 'Failed to delete league');
    } finally {
      setDeletingId(null);
    }
  };

  if (adminLoading || loading) {
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
                  {L.status === 'CANCELLED' && (
                    <span className="rounded bg-amber-900/60 px-2 py-0.5 text-xs font-medium text-amber-100">
                      Cancelled
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

                {isAdmin && (L.canCancel || L.canDelete) && (
                  <div
                    className="admin-actions mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    {L.canCancel && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleCancel(L);
                        }}
                        disabled={cancellingId === L.id || deletingId === L.id}
                        className="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {cancellingId === L.id ? 'Cancelling…' : 'Cancel league'}
                      </button>
                    )}
                    {L.canDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleDelete(L);
                        }}
                        disabled={cancellingId === L.id || deletingId === L.id}
                        className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingId === L.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

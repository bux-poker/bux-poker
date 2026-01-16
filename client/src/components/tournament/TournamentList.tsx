import { Link, useNavigate } from 'react-router-dom';
import { useTournaments, Tournament } from '../../hooks/useTournaments';
import { useAdmin } from '../../hooks/useAdmin';
import { useState } from 'react';
import api from '../../services/api';

function TournamentCard({ tournament, onCancel, onDuplicate }: { tournament: Tournament; onCancel?: (id: string) => void; onDuplicate?: (id: string) => void }) {
  const { isAdmin } = useAdmin();
  const startTime = new Date(tournament.startTime);
  const registeredCount = tournament.registeredCount || 0;
  const spotsLeft = tournament.maxPlayers - registeredCount;
  const servers = tournament.servers || [];

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on admin buttons
    if ((e.target as HTMLElement).closest('.admin-actions')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <Link
      to={`/tournaments/${tournament.id}`}
      onClick={handleCardClick}
      className="block rounded-lg border border-slate-800 bg-slate-900/50 p-6 transition-all hover:border-emerald-500/50 hover:bg-slate-900"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-slate-100">
            {tournament.name}
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            {startTime.toLocaleString()}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            tournament.status === 'ACTIVE' || tournament.status === 'RUNNING'
              ? 'bg-emerald-500/20 text-emerald-200'
              : tournament.status === 'REGISTERING' || tournament.status === 'REGISTRATION'
              ? 'bg-blue-500/20 text-blue-200'
              : tournament.status === 'COMPLETED'
              ? 'bg-slate-500/20 text-slate-300'
              : 'bg-yellow-500/20 text-yellow-200'
          }`}
        >
          {tournament.status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-slate-500">Players</span>
          <p className="mt-1 font-medium text-slate-200">
            {registeredCount} / {tournament.maxPlayers}
          </p>
        </div>
        <div>
          <span className="text-slate-500">Starting Chips</span>
          <p className="mt-1 font-medium text-slate-200">
            {tournament.startingChips.toLocaleString()}
          </p>
        </div>
      </div>

      {servers.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="mb-2 text-xs font-medium text-slate-400">Host Servers:</div>
          <div className="flex flex-wrap gap-2">
            {servers.map((server) => (
              <div
                key={server.id}
                className="flex items-center gap-1.5 rounded bg-slate-800/50 px-2 py-1 text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (server.inviteLink) {
                    window.open(server.inviteLink, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                <span className="text-slate-300">{server.serverName}</span>
                {server.inviteLink && (
                  <svg
                    className="h-3 w-3 text-emerald-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {spotsLeft > 0 && (tournament.status === 'REGISTERING' || tournament.status === 'REGISTRATION' || tournament.status === 'SCHEDULED') && (
        <div className="mt-4 text-xs text-emerald-400">
          {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} remaining
        </div>
      )}

      {/* Admin Actions */}
      {isAdmin && (
        <div className="admin-actions mt-4 border-t border-slate-800 pt-4 flex gap-2">
          {(tournament.status === 'SCHEDULED' || tournament.status === 'REGISTERING' || tournament.status === 'REGISTRATION') && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onCancel) onCancel(tournament.id);
              }}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
            >
              Cancel Tournament
            </button>
          )}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onDuplicate) onDuplicate(tournament.id);
            }}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            Duplicate
          </button>
        </div>
      )}
    </Link>
  );
}

export function TournamentList() {
  const { tournaments, loading, error, refetch } = useTournaments();
  const navigate = useNavigate();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const handleCancel = async (tournamentId: string) => {
    if (!confirm('Are you sure you want to cancel this tournament?')) {
      return;
    }

    setCancelling(tournamentId);
    try {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        alert('Not authenticated');
        return;
      }

      await api.patch(
        `/api/admin/tournaments/${tournamentId}/cancel`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      await refetch();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to cancel tournament');
    } finally {
      setCancelling(null);
    }
  };

  const handleDuplicate = async (tournamentId: string) => {
    setDuplicating(tournamentId);
    try {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        alert('Not authenticated');
        return;
      }

      const response = await api.post(
        `/api/admin/tournaments/${tournamentId}/duplicate`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.data?.id) {
        navigate(`/admin`);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to duplicate tournament');
    } finally {
      setDuplicating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading tournaments...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-200">
        Error: {error}
      </div>
    );
  }

  if (tournaments.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-8 text-center">
        <p className="text-slate-400">No tournaments available</p>
      </div>
    );
  }

  const activeTournaments = tournaments.filter(
    (t) => t.status === 'ACTIVE' || t.status === 'RUNNING'
  );
  const upcomingTournaments = tournaments.filter(
    (t) =>
      t.status === 'REGISTRATION' ||
      t.status === 'REGISTERING' ||
      t.status === 'UPCOMING' ||
      t.status === 'SCHEDULED'
  );
  const completedTournaments = tournaments.filter(
    (t) => t.status === 'COMPLETED'
  );

  return (
    <div className="space-y-8">
      {activeTournaments.length > 0 && (
        <div>
          <h2 className="mb-4 text-xl font-semibold text-slate-100">
            Active Tournaments
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeTournaments.map((tournament) => (
              <TournamentCard 
                key={tournament.id} 
                tournament={tournament} 
                onCancel={handleCancel}
                onDuplicate={handleDuplicate}
              />
            ))}
          </div>
        </div>
      )}

      {upcomingTournaments.length > 0 && (
        <div>
          <h2 className="mb-4 text-xl font-semibold text-slate-100">
            Upcoming Tournaments
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {upcomingTournaments.map((tournament) => (
              <TournamentCard 
                key={tournament.id} 
                tournament={tournament} 
                onCancel={handleCancel}
                onDuplicate={handleDuplicate}
              />
            ))}
          </div>
        </div>
      )}

      {completedTournaments.length > 0 && (
        <div>
          <h2 className="mb-4 text-xl font-semibold text-slate-100">
            Completed Tournaments
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {completedTournaments.map((tournament) => (
              <TournamentCard 
                key={tournament.id} 
                tournament={tournament} 
                onCancel={handleCancel}
                onDuplicate={handleDuplicate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

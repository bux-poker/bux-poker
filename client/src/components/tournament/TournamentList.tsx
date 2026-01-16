import { Link, useNavigate } from 'react-router-dom';
import { useTournaments, Tournament } from '../../hooks/useTournaments';
import { useAdmin } from '../../hooks/useAdmin';
import { useState, useEffect } from 'react';
import api from '../../services/api';
import { TournamentTimestamp } from './TournamentTimestamp';
import { useAuth } from '@shared/features/auth/AuthContext';

interface ServerWithMembership {
  id: string;
  serverId: string;
  serverName: string;
  inviteLink: string | null;
  isMember?: boolean;
}

function TournamentCard({ tournament, onCancel, onDuplicate }: { tournament: Tournament; onCancel?: (id: string) => void; onDuplicate?: (id: string) => void }) {
  const { isAdmin } = useAdmin();
  const { user } = useAuth();
  const startTime = new Date(tournament.startTime);
  const registeredCount = tournament.registeredCount || 0;
  const spotsLeft = tournament.maxPlayers - registeredCount;
  const servers = tournament.servers || [];
  const [serversWithMembership, setServersWithMembership] = useState<ServerWithMembership[]>(servers);

  useEffect(() => {
    // Fetch server membership status
    if (user && servers.length > 0) {
      const token = localStorage.getItem('sessionToken');
      if (token) {
        api.get(`/api/tournaments/${tournament.id}/server-membership`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((response) => {
            if (response.data?.servers) {
              setServersWithMembership(response.data.servers);
            }
          })
          .catch(() => {
            // If not authenticated or error, just use servers as-is
            setServersWithMembership(servers.map(s => ({ ...s, isMember: false })));
          });
      } else {
        setServersWithMembership(servers.map(s => ({ ...s, isMember: false })));
      }
    } else {
      setServersWithMembership(servers.map(s => ({ ...s, isMember: false })));
    }
  }, [tournament.id, servers, user]);

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
          <TournamentTimestamp startTime={startTime} showCountdown={tournament.status === 'SCHEDULED' || tournament.status === 'REGISTERING' || tournament.status === 'REGISTRATION'} />
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

      {serversWithMembership.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="mb-2 text-xs font-medium text-slate-400">Registration Available From:</div>
          <div className="space-y-2">
            {serversWithMembership.map((server) => (
              <div
                key={server.id}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
                  server.isMember ? 'bg-slate-800/30' : 'bg-slate-800/50'
                }`}
              >
                {server.isMember ? (
                  <>
                    <img
                      src="/images/bux-poker.png"
                      alt={server.serverName}
                      className="h-4 w-4 rounded object-contain"
                    />
                    <span className="text-slate-300">{server.serverName}</span>
                  </>
                ) : (
                  <>
                    <img
                      src="/images/bux-poker.png"
                      alt={server.serverName}
                      className="h-4 w-4 rounded object-contain opacity-50"
                    />
                    <span className="text-slate-300">{server.serverName}</span>
                    {server.inviteLink && (
                      <a
                        href={server.inviteLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        className="ml-auto rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
                      >
                        Join
                      </a>
                    )}
                  </>
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

      const response = await api.get(
        `/api/admin/tournaments/${tournamentId}/duplicate`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.data) {
        // Navigate to create page with pre-filled data
        const params = new URLSearchParams({
          name: response.data.name || '',
          description: response.data.description || '',
          maxPlayers: response.data.maxPlayers?.toString() || '100',
          seatsPerTable: response.data.seatsPerTable?.toString() || '9',
          startingChips: response.data.startingChips?.toString() || '10000',
          prizePlaces: response.data.prizePlaces?.toString() || '3',
          blindLevels: JSON.stringify(response.data.blindLevels || []),
        });
        navigate(`/admin?${params.toString()}`);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to load tournament data');
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

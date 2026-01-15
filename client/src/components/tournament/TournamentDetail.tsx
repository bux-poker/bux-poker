import { useParams, useNavigate } from 'react-router-dom';
import { useTournament } from '../../hooks/useTournaments';
import { useState } from 'react';

export function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tournament, loading, error, register } = useTournament(id);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const handleRegister = async () => {
    setRegistering(true);
    setRegisterError(null);
    const result = await register();
    setRegistering(false);
    if (result && !result.success) {
      setRegisterError(result.error || 'Registration failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading tournament...</div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-200">
        {error || 'Tournament not found'}
      </div>
    );
  }

  const startTime = new Date(tournament.startTime);
  const registeredCount = tournament.registeredCount || 0;
  const spotsLeft = tournament.maxPlayers - registeredCount;
  const canRegister =
    (tournament.status === 'REGISTRATION' ||
      tournament.status === 'REGISTERING' ||
      tournament.status === 'SCHEDULED') &&
    spotsLeft > 0;
  const servers = tournament.servers || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/tournaments')}
          className="text-slate-400 hover:text-slate-200"
        >
          ← Back to Tournaments
        </button>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-100">
              {tournament.name}
            </h1>
            <p className="mt-2 text-slate-400">
              Starts: {startTime.toLocaleString()}
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              tournament.status === 'ACTIVE' || tournament.status === 'RUNNING'
                ? 'bg-emerald-500/20 text-emerald-200'
                : tournament.status === 'REGISTRATION' ||
                  tournament.status === 'REGISTERING'
                ? 'bg-blue-500/20 text-blue-200'
                : tournament.status === 'COMPLETED'
                ? 'bg-slate-500/20 text-slate-300'
                : 'bg-yellow-500/20 text-yellow-200'
            }`}
          >
            {tournament.status}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          <div>
            <span className="text-sm text-slate-500">Max Players</span>
            <p className="mt-1 text-lg font-semibold text-slate-200">
              {tournament.maxPlayers}
            </p>
          </div>
          <div>
            <span className="text-sm text-slate-500">Registered</span>
            <p className="mt-1 text-lg font-semibold text-slate-200">
              {registeredCount}
            </p>
          </div>
          <div>
            <span className="text-sm text-slate-500">Starting Chips</span>
            <p className="mt-1 text-lg font-semibold text-slate-200">
              {tournament.startingChips.toLocaleString()}
            </p>
          </div>
          <div>
            <span className="text-sm text-slate-500">Seats per Table</span>
            <p className="mt-1 text-lg font-semibold text-slate-200">
              {tournament.seatsPerTable}
            </p>
          </div>
        </div>

        {canRegister && (
          <div className="mt-6">
            <button
              onClick={handleRegister}
              disabled={registering}
              className="rounded-lg bg-emerald-500 px-6 py-3 font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              {registering ? 'Registering...' : 'Register for Tournament'}
            </button>
            {registerError && (
              <p className="mt-2 text-sm text-red-400">{registerError}</p>
            )}
          </div>
        )}

        {servers.length > 0 && (
          <div className="mt-6 border-t border-slate-800 pt-6">
            <h3 className="mb-4 text-lg font-semibold text-slate-100">
              Host Servers
            </h3>
            <div className="space-y-3">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700">
                      <span className="text-lg">📱</span>
                    </div>
                    <div>
                      <p className="font-medium text-slate-200">
                        {server.serverName}
                      </p>
                      <p className="text-sm text-slate-400">
                        Join to register via Discord
                      </p>
                    </div>
                  </div>
                  {server.inviteLink ? (
                    <a
                      href={server.inviteLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                    >
                      Join Server
                    </a>
                  ) : (
                    <span className="text-sm text-slate-500">
                      No invite link
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tournament.status === 'ACTIVE' || tournament.status === 'RUNNING' ? (
          <div className="mt-6">
            <button
              onClick={() => navigate(`/game/${tournament.id}`)}
              className="rounded-lg bg-blue-500 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-600"
            >
              Join Game
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

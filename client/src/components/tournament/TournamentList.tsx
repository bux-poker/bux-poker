import { Link } from 'react-router-dom';
import { useTournaments, Tournament } from '../../hooks/useTournaments';

function TournamentCard({ tournament }: { tournament: Tournament }) {
  const startTime = new Date(tournament.startTime);
  const registeredCount = tournament.registeredCount || 0;
  const spotsLeft = tournament.maxPlayers - registeredCount;

  return (
    <Link
      to={`/tournaments/${tournament.id}`}
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
            tournament.status === 'ACTIVE'
              ? 'bg-emerald-500/20 text-emerald-200'
              : tournament.status === 'REGISTRATION'
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

      {spotsLeft > 0 && tournament.status === 'REGISTRATION' && (
        <div className="mt-4 text-xs text-emerald-400">
          {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} remaining
        </div>
      )}
    </Link>
  );
}

export function TournamentList() {
  const { tournaments, loading, error } = useTournaments();

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

  const activeTournaments = tournaments.filter((t) => t.status === 'ACTIVE');
  const upcomingTournaments = tournaments.filter(
    (t) => t.status === 'REGISTRATION' || t.status === 'UPCOMING'
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
              <TournamentCard key={tournament.id} tournament={tournament} />
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
              <TournamentCard key={tournament.id} tournament={tournament} />
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
              <TournamentCard key={tournament.id} tournament={tournament} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

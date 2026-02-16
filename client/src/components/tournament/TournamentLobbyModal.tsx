/**
 * Tournament lobby as a modal (same tabs as main TournamentLobby).
 * Used from the game table to view tournament info without leaving the game.
 */
import { useState, useEffect } from 'react';
import { useTournament } from '../../hooks/useTournaments';
import { useAuth } from '@shared/features/auth/AuthContext';
import { getSocket } from '../../services/socket';

type Tab = 'players' | 'blinds' | 'prizes' | 'tables';

interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  duration: number | null;
  breakAfter?: number;
}

interface PlayerRow {
  id: string;
  userId: string;
  user: { id: string; username?: string; avatarUrl?: string };
  chips: number;
  status: string;
  position?: number | null;
}

export function TournamentLobbyModal({
  tournamentId,
  onClose,
}: {
  tournamentId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { tournament, loading, error, refetch } = useTournament(tournamentId);
  const [activeTab, setActiveTab] = useState<Tab>('players');
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [blindLevels, setBlindLevels] = useState<BlindLevel[]>([]);
  const [tables, setTables] = useState<any[]>([]);

  useEffect(() => {
    if (!tournamentId) return;
    const socket = getSocket();
    const handler = () => refetch({ silent: true });
    socket.on('tournament_updated', handler);
    socket.on('tournament_completed', handler);
    return () => {
      socket.off('tournament_updated', handler);
      socket.off('tournament_completed', handler);
    };
  }, [tournamentId, refetch]);

  useEffect(() => {
    if (tournament?.blindLevels) {
      try {
        const parsed =
          typeof tournament.blindLevels === 'string'
            ? JSON.parse(tournament.blindLevels)
            : tournament.blindLevels;
        setBlindLevels(parsed || []);
      } catch {
        setBlindLevels([]);
      }
    }
  }, [tournament]);

  useEffect(() => {
    if (!tournament) return;
    if (tournament.games && Array.isArray(tournament.games)) {
      setTables(
        tournament.games.filter(
          (g: any) =>
            (g.players?.filter(
              (p: any) => p.status !== 'ELIMINATED' && (p.chips ?? 0) > 0
            )?.length ?? 0) > 0
        )
      );
    } else {
      setTables([]);
    }
  }, [tournament]);

  useEffect(() => {
    if (!tournament) return;
    const raw = (tournament as any).players;
    if (raw && Array.isArray(raw)) {
      const list = raw
        .map((p: any) => ({
          id: p.id,
          userId: p.userId,
          user: p.user || {},
          chips: p.chips ?? 0,
          status: p.status ?? '',
          position: p.finishingPlace ?? p.position ?? null,
        }))
        .sort((a: PlayerRow, b: PlayerRow) => (b.chips ?? 0) - (a.chips ?? 0));
      setPlayers(list);
    } else {
      setPlayers([]);
    }
  }, [tournament]);

  const isCompleted =
    tournament?.status === 'COMPLETED' || tournament?.status === 'CANCELLED';
  const isRunning =
    tournament?.status === 'RUNNING' || tournament?.status === 'ACTIVE';
  const registeredCount = tournament?.registeredCount ?? 0;
  const remainingPlayers = (tournament as any)?.remainingPlayers ?? players.filter((p) => p.status !== 'ELIMINATED').length;

  if (loading && !tournament) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="rounded-lg bg-slate-800 px-6 py-4 text-slate-300">
          Loading tournament…
        </div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="rounded-lg border border-red-500/30 bg-slate-800 p-6 text-red-200 max-w-md">
          <p>{error || 'Tournament not found'}</p>
          <button
            onClick={onClose}
            className="mt-4 rounded bg-slate-600 px-4 py-2 text-sm text-white hover:bg-slate-500"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3 sm:px-6">
          <h2 className="truncate text-lg font-semibold text-white">
            {tournament.name}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="border-b border-slate-800">
          <nav className="flex -mb-px overflow-x-auto">
            <button
              onClick={() => setActiveTab('players')}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors sm:px-6 ${
                activeTab === 'players'
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Players {isCompleted && '(Final Standings)'}
            </button>
            <button
              onClick={() => setActiveTab('blinds')}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors sm:px-6 ${
                activeTab === 'blinds'
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Blind Levels
            </button>
            <button
              onClick={() => setActiveTab('prizes')}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors sm:px-6 ${
                activeTab === 'prizes'
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Prizes
            </button>
            {(isRunning || tables.length > 0) && (
              <button
                onClick={() => setActiveTab('tables')}
                className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors sm:px-6 ${
                  activeTab === 'tables'
                    ? 'border-b-2 border-emerald-500 text-emerald-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Tables ({tables.length})
              </button>
            )}
          </nav>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'players' && (
            <div className="space-y-2 sm:space-y-3">
              {players.length === 0 ? (
                <p className="py-6 text-center text-slate-400">No players.</p>
              ) : (
                players.map((player, index) => {
                  const place = player.position ?? index + 1;
                  const ordinal =
                    place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
                  return (
                    <div
                      key={player.id}
                      className={`flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 p-3 sm:p-4 ${
                        user?.id === player.userId ? 'border-emerald-500/50 bg-emerald-500/5' : ''
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                        {isCompleted && place && (
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-slate-200 sm:h-10 sm:w-10 sm:text-lg">
                            {place}
                          </div>
                        )}
                        {!isCompleted && (
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-medium text-slate-300 sm:h-10 sm:w-10 sm:text-sm">
                            {index + 1}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-200">
                            {player.user?.username || 'Player'}
                            {user?.id === player.userId && (
                              <span className="ml-2 text-xs text-emerald-400">(You)</span>
                            )}
                          </p>
                          {isRunning && (
                            <p className="text-xs text-slate-400">Status: {player.status}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {isCompleted ? (
                          <p className="font-semibold text-slate-200">
                            {ordinal}
                            {place === 1 && player.chips > 0 && (
                              <span className="ml-2 font-normal text-emerald-400">
                                ({player.chips.toLocaleString()} chips)
                              </span>
                            )}
                          </p>
                        ) : (
                          <>
                            <p className="font-semibold text-slate-200">
                              {player.chips.toLocaleString()} chips
                            </p>
                            {isRunning && player.position && (
                              <p className="text-xs text-slate-400">
                                Position: {player.position}th
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'blinds' && (
            <div className="space-y-2 sm:space-y-3">
              {blindLevels.length === 0 ? (
                <p className="py-6 text-center text-slate-400">No blind levels.</p>
              ) : (
                blindLevels.map((level) => (
                  <div
                    key={level.level}
                    className="rounded-lg border border-slate-800 bg-slate-800/30 p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-200">
                        Level {level.level}
                      </span>
                      <p className="text-lg font-bold text-slate-100">
                        {level.smallBlind} / {level.bigBlind}
                      </p>
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      {level.duration == null ? '∞' : `${level.duration} min`}
                      {level.breakAfter != null && ` · ${level.breakAfter} min break`}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'prizes' && (
            <div className="py-8 text-center text-slate-400">
              Prize structure coming soon
            </div>
          )}

          {activeTab === 'tables' && (
            <div className="space-y-3">
              {tables.length === 0 ? (
                <p className="py-6 text-center text-slate-400">No tables.</p>
              ) : (
                tables.map((table) => {
                  const activePlayers =
                    table.players?.filter((p: any) => p.status !== 'ELIMINATED') ?? [];
                  return (
                    <div
                      key={table.id}
                      className="rounded-lg border border-slate-800 bg-slate-800/30 p-4"
                    >
                      <h3 className="font-semibold text-slate-200">
                        Table {table.tableNumber}
                      </h3>
                      <p className="mt-1 text-sm text-slate-400">
                        {activePlayers.length} / {tournament.seatsPerTable} players
                      </p>
                      {activePlayers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {activePlayers.map((p: any) => (
                            <span
                              key={p.id}
                              className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300"
                            >
                              {p.user?.username || 'Player'}
                              {p.userId === user?.id && ' (You)'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
            <span>
              {remainingPlayers} / {registeredCount} players
            </span>
            <span className="rounded bg-slate-700/50 px-2 py-0.5 font-medium text-slate-300">
              {tournament.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

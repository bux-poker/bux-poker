/**
 * Tournament lobby as a modal (same tabs as main TournamentLobby).
 * Used from the game table to view tournament info without leaving the game.
 */
import { useState, useEffect } from 'react';
import { useTournament } from '../../hooks/useTournaments';
import { useAuth } from '@shared/features/auth/AuthContext';
import { useAdmin } from '../../hooks/useAdmin';
import { getSocket } from '../../services/socket';
import api from '../../services/api';

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

/** Optional game state from the table (for current blinds and live chip counts). */
export interface GameStateForLobby {
  smallBlind?: number;
  bigBlind?: number;
  players?: Array<{ userId?: string; chips?: number; status?: string }>;
}

export function TournamentLobbyModal({
  tournamentId,
  onClose,
  gameState,
}: {
  tournamentId: string;
  onClose: () => void;
  /** When opened from a game table, pass game state to show current blinds and live chips */
  gameState?: GameStateForLobby | null;
}) {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const { tournament, loading, error, refetch } = useTournament(tournamentId);
  const [activeTab, setActiveTab] = useState<Tab>('players');
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [blindLevels, setBlindLevels] = useState<BlindLevel[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [addingTestPlayers, setAddingTestPlayers] = useState(false);

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
      const totalPlayers = tournament.registeredCount ?? raw.length;
      const rows = raw.map((p: any) => ({
        id: p.id,
        userId: p.userId,
        user: p.user || {},
        chips: p.chips ?? 0,
        status: p.status ?? '',
        position: p.finishingPlace ?? p.position ?? null,
      }));
      // Merge live chips from gameState if provided (same userId)
      const withLiveChips = gameState?.players?.length
        ? rows.map((p: PlayerRow) => {
            const live = gameState.players?.find((gp) => gp.userId === p.userId);
            if (live && live.chips !== undefined) return { ...p, chips: live.chips, status: live.status ?? p.status };
            return p;
          })
        : rows;
      // Order: (1) active with chips > 0 by chips desc, (2) active with 0 chips (all-in), (3) eliminated by finishing place (first out = worst = at bottom)
      const activeWithChips = withLiveChips.filter((p: PlayerRow) => p.status !== 'ELIMINATED' && (p.chips ?? 0) > 0);
      const allIn = withLiveChips.filter((p: PlayerRow) => p.status !== 'ELIMINATED' && (p.chips ?? 0) === 0);
      const eliminated = withLiveChips.filter((p: PlayerRow) => p.status === 'ELIMINATED');
      activeWithChips.sort((a: PlayerRow, b: PlayerRow) => (b.chips ?? 0) - (a.chips ?? 0));
      // Eliminated: finishingPlace asc (4th before 7th) — first out = worst place = largest number = bottom (matches server sortTournamentStandings)
      eliminated.sort((a: PlayerRow, b: PlayerRow) => (a.position ?? 999) - (b.position ?? 999));
      setPlayers([...activeWithChips, ...allIn, ...eliminated]);
    } else {
      setPlayers([]);
    }
  }, [tournament, gameState?.players]);

  const isCompleted =
    tournament?.status === 'COMPLETED' || tournament?.status === 'CANCELLED';
  const isRunning =
    tournament?.status === 'RUNNING' || tournament?.status === 'ACTIVE';
  const registeredCount = tournament?.registeredCount ?? 0;
  const remainingPlayers = (tournament as any)?.remainingPlayers ?? players.filter((p) => p.status !== 'ELIMINATED').length;
  const currentBlindLevelIndex =
    gameState?.smallBlind != null && gameState?.bigBlind != null && blindLevels.length > 0
      ? blindLevels.findIndex(
          (l) => l.smallBlind === gameState.smallBlind && l.bigBlind === gameState.bigBlind
        )
      : -1;

  const canAddTestPlayers =
    isAdmin &&
    !!tournament &&
    !isCompleted &&
    !isRunning &&
    tournament.status !== 'CANCELLED';

  const handleAddTestPlayers = async () => {
    if (!tournament) return;
    const currentRegistered = tournament.registeredCount ?? 0;
    const maxPlayers = tournament.maxPlayers;
    const availableSlots = maxPlayers - currentRegistered;
    if (availableSlots <= 0) {
      alert('Tournament is full!');
      return;
    }
    const defaultCount = Math.min(tournament.seatsPerTable ?? 9, availableSlots);
    const countInput = window.prompt(
      'How many test players would you like to add?',
      String(defaultCount)
    );
    if (countInput == null) return;
    const count = parseInt(countInput, 10);
    if (Number.isNaN(count) || count < 1 || count > availableSlots) {
      alert('Please enter a number between 1 and ' + String(availableSlots));
      return;
    }
    if (!window.confirm('Add ' + String(count) + ' test player(s)?')) {
      return;
    }
    setAddingTestPlayers(true);
    try {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        alert('Not authenticated');
        return;
      }
      const response = await api.post(
        '/api/admin/tournaments/' + tournamentId + '/add-test-players',
        { count: count },
        { headers: { Authorization: 'Bearer ' + token } }
      );
      alert(response.data.message || 'Added ' + String(count) + ' test player(s)');
      await refetch({ silent: true });
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(ax.response?.data?.error || 'Failed to add test players');
      console.error('Error adding test players:', err);
    } finally {
      setAddingTestPlayers(false);
    }
  };

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

        {canAddTestPlayers && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-900/40 bg-purple-950/30 px-4 py-2 sm:px-6">
            <span className="text-xs font-medium text-purple-200/90">Admin</span>
            <button
              type="button"
              onClick={() => {
                void handleAddTestPlayers();
              }}
              disabled={addingTestPlayers}
              className="rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Add test players for development/testing"
            >
              {addingTestPlayers ? 'Adding...' : 'Add test players'}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'players' && (
            <div className="space-y-2 sm:space-y-3">
              {players.length === 0 ? (
                <p className="py-6 text-center text-slate-400">No players.</p>
              ) : (
                players.map((player, index) => {
                  const isEliminated = player.status === 'ELIMINATED';
                  const place = player.position ?? (isEliminated ? null : index + 1);
                  const ordinal =
                    place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : place != null ? `${place}th` : '–';
                  const isYou = user?.id === player.userId;
                  return (
                    <div
                      key={player.id}
                      className={`flex items-center justify-between rounded-lg border p-3 sm:p-4 ${
                        isYou
                          ? 'border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-500/50'
                          : 'border-slate-800 bg-slate-800/30'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                        {place != null && place > 0 ? (
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-slate-200 sm:h-10 sm:w-10 sm:text-lg">
                            {place}
                          </div>
                        ) : !isEliminated ? (
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-medium text-slate-300 sm:h-10 sm:w-10 sm:text-sm">
                            –
                          </div>
                        ) : (
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700/70 text-sm font-bold text-slate-400 sm:h-10 sm:w-10 sm:text-lg">
                            {player.position != null ? player.position : '–'}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-200">
                            {player.user?.username || 'Player'}
                            {isYou && (
                              <span className="ml-2 text-xs font-medium text-emerald-400">(You)</span>
                            )}
                          </p>
                          {isRunning && !isEliminated && (
                            <p className="text-xs text-slate-400">
                              {player.chips === 0 ? 'All-in' : `Status: ${player.status}`}
                            </p>
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
                        ) : isEliminated ? (
                          <p className="font-semibold text-slate-400">{ordinal}</p>
                        ) : (
                          <>
                            <p className="font-semibold text-slate-200">
                              {player.chips.toLocaleString()} chips
                            </p>
                            {player.chips === 0 && (
                              <p className="text-xs text-amber-400/90">All-in</p>
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
                blindLevels.map((level, idx) => {
                  const isCurrentRound = isRunning && currentBlindLevelIndex === idx;
                  return (
                    <div
                      key={level.level}
                      className={`rounded-lg border p-3 sm:p-4 ${
                        isCurrentRound
                          ? 'border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-500/50'
                          : 'border-slate-800 bg-slate-800/30'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200">
                          Level {level.level}
                          {isCurrentRound && (
                            <span className="ml-2 text-xs font-medium text-emerald-400">(current)</span>
                          )}
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
                  );
                })
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

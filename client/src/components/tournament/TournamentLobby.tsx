import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTournament } from '../../hooks/useTournaments';
import { useAuth } from '@shared/features/auth/AuthContext';
import { useAdmin } from '../../hooks/useAdmin';
import { getSocket } from '../../services/socket';
import { TournamentTimestamp } from './TournamentTimestamp';
import { formatLocalDateTime } from '../../utils/formatLocalDateTime';
import { AddToHomeScreen } from '../AddToHomeScreen';
import api from '../../services/api';
import {
  getBlindScheduleForTournament,
  getBlindCountdownFromTournamentSchedule,
} from '@shared/utils/tournamentBlindSchedule';

type Tab = 'players' | 'blinds' | 'prizes' | 'tables';

interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  duration: number | null;
  breakAfter?: number;
}

interface Player {
  id: string;
  userId: string;
  user: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  chips: number;
  status: string;
  position?: number;
}

export function TournamentLobby() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const { tournament, loading, error, refetch } = useTournament(id);

  // Live update: refetch when tournament_updated or tournament_completed fires
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    const handler = (payload: { tournamentId: string }) => {
      if (payload.tournamentId === id) refetch({ silent: true });
    };
    socket.on('tournament_updated', handler);
    socket.on('tournament_completed', handler);
    return () => {
      socket.off('tournament_updated', handler);
      socket.off('tournament_completed', handler);
    };
  }, [id, refetch]);

  // Hide Start button as soon as server says tournament is starting (so it stays hidden in every tab/window)
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    const handler = (payload: { tournamentId: string }) => {
      if (payload.tournamentId === id) setStartRequested(true);
    };
    socket.on('tournament-starting', handler);
    return () => { socket.off('tournament-starting', handler); };
  }, [id]);

  // Poll when running so tables/players stay current (silent = no loading flash)
  useEffect(() => {
    if (!id || !tournament || (tournament.status !== 'RUNNING' && tournament.status !== 'ACTIVE')) return;
    const interval = setInterval(() => refetch({ silent: true }), 5000);
    return () => clearInterval(interval);
  }, [id, tournament?.status, refetch]);
  const [activeTab, setActiveTab] = useState<Tab>('players');
  const [players, setPlayers] = useState<Player[]>([]);
  const [runningTime, setRunningTime] = useState<string>('');
  const [currentBlindLevel, setCurrentBlindLevel] = useState<BlindLevel | null>(null);
  const [nextBlindLevel, setNextBlindLevel] = useState<BlindLevel | null>(null);
  const [nextBlindIn, setNextBlindIn] = useState<string>('');
  const [remainingPlayers, setRemainingPlayers] = useState<number>(0);
  const [currentPosition, setCurrentPosition] = useState<number | null>(null);
  const [blindLevels, setBlindLevels] = useState<BlindLevel[]>([]);
  const [closingRegistration, setClosingRegistration] = useState(false);
  const [startingTournament, setStartingTournament] = useState(false);
  const [startRequested, setStartRequested] = useState(false);
  const [tables, setTables] = useState<any[]>([]);
  const [myGameId, setMyGameId] = useState<string | null>(null);
  const [addingTestPlayers, setAddingTestPlayers] = useState(false);

  // Clear start-requested flag once tournament is actually running (after refetch)
  useEffect(() => {
    if (tournament?.status === 'RUNNING' || tournament?.status === 'ACTIVE') {
      setStartRequested(false);
    }
  }, [tournament?.status]);

  // Parse blind levels from tournament
  useEffect(() => {
    if (tournament?.blindLevels) {
      try {
        const parsed = typeof tournament.blindLevels === 'string' 
          ? JSON.parse(tournament.blindLevels) 
          : tournament.blindLevels;
        setBlindLevels(parsed || []);
      } catch (e) {
        console.error('Failed to parse blind levels:', e);
        setBlindLevels([]);
      }
    }
  }, [tournament]);

  // Fetch tables/games for tournament
  useEffect(() => {
    if (!tournament || !id) return;

    const fetchTables = async () => {
      try {
        // Tables are included in tournament data from getTournamentById
        if (tournament.games && Array.isArray(tournament.games)) {
          // Hide tables with 0 active players (exclude eliminated/0-chip; closed tables)
          setTables(tournament.games.filter((g: any) =>
            (g.players?.filter((p: any) => p.status !== 'ELIMINATED' && (p.chips ?? 0) > 0)?.length ?? 0) > 0
          ));
        }
      } catch (err) {
        console.error('Error fetching tables:', err);
      }
    };

    fetchTables();
  }, [tournament, id]);

  // Fetch user's table/game
  useEffect(() => {
    if (!tournament || !user || !id) return;

    const fetchMyTable = async () => {
      try {
        const token = localStorage.getItem('sessionToken');
        if (!token) return;

        const response = await api.get(`/api/tournaments/${id}/my-table`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMyGameId(response.data.gameId);
      } catch (err: any) {
        // User might not be playing, that's ok
        if (err.response?.status !== 404) {
          console.error('Error fetching my table:', err);
        }
        setMyGameId(null);
      }
    };

    fetchMyTable();
  }, [tournament, user, id]);

  // Do NOT auto-open the game from the lobby - it causes duplicate tabs when the user
  // already has the game open. Open game only via explicit "Join table" / "Your table" click.
  // On reseat, the existing game tab receives consolidation-complete and navigates in-place.

  // Calculate running tournament stats + sync blinds / remaining players with game state
  useEffect(() => {
    if (!tournament || (tournament.status !== 'RUNNING' && tournament.status !== 'ACTIVE')) {
      return;
    }

    const updateRunningStats = async () => {
      // Calculate running time - use startedAt if available, otherwise startTime
      const actualStartTime = (tournament as any).startedAt 
        ? new Date((tournament as any).startedAt) 
        : new Date(tournament.startTime);
      const now = new Date();
      const diff = now.getTime() - actualStartTime.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setRunningTime(`${hours}h ${minutes}m`);

      // Blind display: anchor + canonical level (matches tables) when server uses barrier scheduling.
      if (blindLevels.length > 0 && (tournament as any).startedAt) {
        const json =
          typeof tournament.blindLevels === 'string'
            ? tournament.blindLevels
            : JSON.stringify(blindLevels.length ? blindLevels : []);
        const tt = tournament as any;
        const useAnchor =
          tt.awaitingHandsForBlindClock === true ||
          tt.blindPeriodAnchorAt != null ||
          tt.tournamentBreakUntilAt != null;

        if (useAnchor) {
          const levelIdx =
            typeof tt.canonicalBlindLevelIndex === 'number'
              ? tt.canonicalBlindLevelIndex
              : 0;
          const clock = getBlindCountdownFromTournamentSchedule({
            blindPeriodAnchorAt: tt.blindPeriodAnchorAt,
            awaitingHandsForBlindClock: !!tt.awaitingHandsForBlindClock,
            tournamentBreakUntilAt: tt.tournamentBreakUntilAt,
            currentLevelIndex: Math.min(levelIdx, blindLevels.length - 1),
            blindLevels,
            nowMs: Date.now(),
          });
          const idx = Math.min(levelIdx, blindLevels.length - 1);
          setCurrentBlindLevel(blindLevels[idx] ?? null);
          if (clock.phase === 'final') {
            setNextBlindLevel(null);
            setNextBlindIn('∞');
          } else {
            const nextIdx = idx + 1;
            setNextBlindLevel(
              nextIdx < blindLevels.length ? blindLevels[nextIdx] ?? null : null
            );
            setNextBlindIn(clock.label);
          }
        } else {
          const sched = getBlindScheduleForTournament((tournament as any).startedAt, json, Date.now());
          if (sched) {
            const currentLevel = blindLevels[sched.currentLevelIndex];
            setCurrentBlindLevel(currentLevel ?? null);
            if (sched.atLastLevel || sched.msUntilNextLevel == null) {
              setNextBlindLevel(null);
              setNextBlindIn(sched.atLastLevel ? '∞' : '--:--');
            } else {
              const nextIdx = sched.currentLevelIndex + 1;
              setNextBlindLevel(blindLevels[nextIdx] ?? null);
              const ms = sched.msUntilNextLevel;
              const mins = Math.floor(ms / 60000);
              const secs = Math.floor((ms % 60000) / 1000);
              setNextBlindIn(`${mins}:${secs.toString().padStart(2, '0')}`);
            }
          }
        }
      }

      // Use live players from tournament payload (flattened in API) so that
      // the lobby always reflects current chip stacks and statuses.
      try {
        // Prefer the tournament instance from the hook (keeps us in sync with
        // other consumers), but refetch as a fallback if needed.
        let data: any = tournament;
        if (!data?.players) {
          const response = await api.get(`/api/tournaments/${id}`);
          data = response.data;
        }

        if (data?.players) {
          // API returns full standings: still-in by chips, then eliminated by finishing place (first out last)
          const rows: Player[] = (data.players as any[]).map((p: any) => ({
            id: p.id,
            userId: p.userId,
            user: p.user,
            chips: p.chips,
            status: p.status,
            position: p.finishingPlace ?? null,
          }));
          setPlayers(rows);

          const nonElim = rows.filter((p) => p.status !== 'ELIMINATED');
          setRemainingPlayers((data as any).remainingPlayers ?? nonElim.length);

          if (user) {
            const activeSorted = [...nonElim].sort((a, b) => b.chips - a.chips);
            const meActiveIndex = activeSorted.findIndex((p) => p.userId === user.id);
            if (meActiveIndex >= 0) {
              setCurrentPosition(meActiveIndex + 1);
            } else {
              const meEliminated = rows.find(
                (p) => p.userId === user.id && p.status === 'ELIMINATED'
              );
              setCurrentPosition(meEliminated?.position ?? null);
            }
          }
        }
      } catch (err) {
        console.error('[TOURNAMENT] Error updating running stats/players:', err);
      }
    };

    updateRunningStats();
    const interval = setInterval(updateRunningStats, 1000);

    return () => clearInterval(interval);
  }, [tournament, blindLevels, user, id]);

  // Initial players list (registrations / fallback). Once the tournament is
  // running, `updateRunningStats` above keeps `players` live, so we avoid
  // overwriting with starting stacks here.
  useEffect(() => {
    if (!tournament) return;

    const fetchPlayers = async () => {
      try {
        // If tournament is running/active, fetch from games
        // Otherwise, fetch from registrations
        if (tournament.status === 'RUNNING' || tournament.status === 'ACTIVE') {
          // Running tournaments: live chip stacks are handled in
          // updateRunningStats; don't overwrite here.
          return;
        } else if (tournament.status === 'COMPLETED') {
          const response = await api.get(`/api/tournaments/${id}`);
          if (response.data?.players && response.data.players.length > 0) {
            const finalPlayers = response.data.players.map((p: any) => ({
              id: p.id,
              userId: p.userId,
              user: p.user,
              chips: p.chips,
              status: p.status,
              position: p.finishingPlace ?? null,
            }));
            setPlayers(finalPlayers);
          } else if (response.data?.registrations) {
            setPlayers(response.data.registrations
              .filter((r: any) => r.status === 'CONFIRMED')
              .map((r: any) => ({
                id: r.id,
                userId: r.userId,
                user: r.user,
                chips: 0,
                status: 'COMPLETED',
                position: null,
              })));
          }
        } else {
          // Show registered players
          const response = await api.get(`/api/tournaments/${id}`);
          if (response.data?.registrations) {
            const registeredPlayers = response.data.registrations
              .filter((r: any) => r.status === 'CONFIRMED' || r.status === 'PENDING')
              .map((r: any) => ({
                id: r.id,
                userId: r.userId,
                user: r.user,
                chips: tournament.startingChips,
                status: r.status,
              }));
            setPlayers(registeredPlayers);
          }
        }
      } catch (err) {
        console.error('Error fetching players:', err);
      }
    };

    fetchPlayers();
  }, [tournament, id]);

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

  const handleCloseRegistration = async () => {
    if (!confirm('Close registration and seat all players? This cannot be undone.')) {
      return;
    }

    setClosingRegistration(true);
    try {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        alert('Not authenticated');
        return;
      }

      await api.post(
        `/api/admin/tournaments/${id}/close-registration`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      alert('✅ Registration closed! Players have been seated. You can now start the tournament.');
      await refetch();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to close registration');
      console.error('Error closing registration:', err);
    } finally {
      setClosingRegistration(false);
    }
  };

  const handleStartTournament = async () => {
    if (!confirm('Start the tournament? This will begin gameplay.')) {
      return;
    }

    setStartingTournament(true);
    setStartRequested(true);
    try {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        alert('Not authenticated');
        setStartRequested(false);
        return;
      }

      await api.post(
        `/api/admin/tournaments/${id}/start`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      alert('✅ Tournament started!');
      await refetch();
    } catch (err: any) {
      setStartRequested(false);
      alert(err.response?.data?.error || 'Failed to start tournament');
      console.error('Error starting tournament:', err);
    } finally {
      setStartingTournament(false);
    }
  };

  const handleAddTestPlayers = async () => {
    if (!tournament || !id) return;
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
        '/api/admin/tournaments/' + id + '/add-test-players',
        { count: count },
        { headers: { Authorization: 'Bearer ' + token } }
      );
      alert(response.data.message || 'Added ' + String(count) + ' test player(s)');
      await refetch();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      alert(ax.response?.data?.error || 'Failed to add test players');
      console.error('Error adding test players:', err);
    } finally {
      setAddingTestPlayers(false);
    }
  };

  const startTime = new Date(tournament.startTime);
  const startScheduledAtRaw = (tournament as { startScheduledAt?: string | null }).startScheduledAt;
  const startScheduledAtMs = startScheduledAtRaw ? new Date(startScheduledAtRaw).getTime() : null;
  const registeredCount = tournament.registeredCount || 0;
  const isRunning = tournament.status === 'RUNNING' || tournament.status === 'ACTIVE';
  const isCompleted = tournament.status === 'COMPLETED';
  const isSeated = tournament.status === 'SEATED';
  const scheduledCountdownActive =
    isSeated &&
    startScheduledAtMs != null &&
    !Number.isNaN(startScheduledAtMs) &&
    startScheduledAtMs > Date.now();
  const isRegistering = tournament.status === 'REGISTERING' || tournament.status === 'REGISTRATION' || tournament.status === 'SCHEDULED';
  const servers = tournament.servers || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={() => navigate('/tournaments')}
          className="text-slate-400 hover:text-slate-200"
        >
          ← Back to Tournaments
        </button>
        <AddToHomeScreen compact />
      </div>

      {/* Tournament Info Card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-slate-100">{tournament.name}</h1>
            {!isCompleted && (
              <div className="mt-2">
                <TournamentTimestamp 
                  startTime={startTime} 
                  showCountdown={!isRunning}
                />
              </div>
            )}
            {isCompleted && (
              <p className="mt-2 text-slate-400">
                Completed: {formatLocalDateTime(startTime)}
              </p>
            )}
          </div>
          <span
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              isRunning
                ? 'bg-emerald-500/20 text-emerald-200'
                : tournament.status === 'REGISTRATION' || tournament.status === 'REGISTERING'
                ? 'bg-blue-500/20 text-blue-200'
                : tournament.status === 'SEATED'
                ? 'bg-purple-500/20 text-purple-200'
                : isCompleted
                ? 'bg-slate-500/20 text-slate-300'
                : 'bg-yellow-500/20 text-yellow-200'
            }`}
          >
            {tournament.status}
          </span>
        </div>

        {/* Join my table - for registered players when tournament is running */}
        {user && (isRunning || isSeated) && myGameId && !isCompleted && (
          <div className="mt-4 flex gap-3 border-t border-slate-800 pt-4">
            <button
              onClick={() => {
                const url = `/game/${myGameId}`;
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
                if (isMobile) {
                  navigate(url);
                } else {
                  const winName = 'buxpoker-game-window';
                  let w = window.open('', winName);
                  if (w && !w.closed) {
                    w.location.href = url;
                    w.focus();
                  } else {
                    w = window.open(url, winName, 'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no');
                    if (w) {
                      w.focus();
                      w.addEventListener('load', () => {
                        setTimeout(() => {
                          if (w?.document?.documentElement?.requestFullscreen) {
                            w.document.documentElement.requestFullscreen().catch(() => {});
                          }
                        }, 500);
                      });
                    }
                  }
                }
              }}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Join my table
            </button>
          </div>
        )}

        {/* Scheduled flow (all users) */}
        {!isCompleted && !isRunning && (
          <p className="mt-3 text-sm text-slate-500">
            <span className="text-slate-400">Schedule:</span> registration closes and players are seated automatically{' '}
            <strong className="text-slate-300">2 minutes before</strong> the start time above; the table then shows a
            countdown until play begins.
          </p>
        )}

        {/* Admin Actions */}
        {isAdmin && !isCompleted && (
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap gap-3">
            {isRegistering && (
              <button
                onClick={handleCloseRegistration}
                disabled={closingRegistration}
                className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {closingRegistration ? 'Closing Registration...' : 'Close registration now (optional)'}
              </button>
            )}
            {!isRunning && tournament.status !== 'CANCELLED' && (
              <button
                type="button"
                onClick={() => {
                  void handleAddTestPlayers();
                }}
                disabled={addingTestPlayers}
                className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Add test players for development/testing"
              >
                {addingTestPlayers ? 'Adding test players...' : 'Add test players'}
              </button>
            )}
            {isSeated && !isRunning && !startRequested && !scheduledCountdownActive && (
              <button
                onClick={handleStartTournament}
                disabled={startingTournament}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {startingTournament ? 'Starting Tournament...' : 'Start tournament now (manual)'}
              </button>
            )}
            {isSeated && startRequested && startingTournament && (
              <span className="text-slate-400 text-sm">Starting Tournament...</span>
            )}
            </div>
          </div>
        )}
        {scheduledCountdownActive && startScheduledAtRaw && (
          <p className="mt-2 text-sm text-amber-200/90">
            Next hand countdown: play begins at {formatLocalDateTime(new Date(startScheduledAtRaw))}.
          </p>
        )}

        {/* Running Tournament Stats */}
        {isRunning && (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4 rounded-lg border border-slate-800 bg-slate-800/30 p-4">
            <div>
              <span className="text-xs text-slate-400">Running For</span>
              <p className="mt-1 text-lg font-semibold text-slate-200">{runningTime}</p>
            </div>
            <div>
              <span className="text-xs text-slate-400">Current Blinds</span>
              <p className="mt-1 text-lg font-semibold text-slate-200">
                {currentBlindLevel ? `${currentBlindLevel.smallBlind}/${currentBlindLevel.bigBlind}` : '-'}
              </p>
            </div>
            <div>
              <span className="text-xs text-slate-400">Next Level</span>
              <p className="mt-1 text-lg font-semibold text-slate-200">
                {nextBlindLevel ? (
                  <>
                    {nextBlindLevel.smallBlind}/{nextBlindLevel.bigBlind}
                    {nextBlindIn && <span className="ml-1 text-sm text-slate-400">in {nextBlindIn}</span>}
                  </>
                ) : '-'}
              </p>
            </div>
            <div>
              <span className="text-xs text-slate-400">Remaining Players</span>
              <p className="mt-1 text-lg font-semibold text-slate-200">
                {remainingPlayers} / {registeredCount}
              </p>
            </div>
            {currentPosition && (
              <div className="col-span-2 md:col-span-4">
                <span className="text-xs text-slate-400">Your Position</span>
                <p className="mt-1 text-lg font-semibold text-emerald-400">{currentPosition}th</p>
              </div>
            )}
          </div>
        )}

        {/* Static Stats */}
        {!isRunning && (
          <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
            <div>
              <span className="text-sm text-slate-500">Max Players</span>
              <p className="mt-1 text-lg font-semibold text-slate-200">{tournament.maxPlayers}</p>
            </div>
            <div>
              <span className="text-sm text-slate-500">Registered</span>
              <p className="mt-1 text-lg font-semibold text-slate-200">{registeredCount}</p>
            </div>
            <div>
              <span className="text-sm text-slate-500">Starting Chips</span>
              <p className="mt-1 text-lg font-semibold text-slate-200">
                {tournament.startingChips.toLocaleString()}
              </p>
            </div>
            <div>
              <span className="text-sm text-slate-500">Seats per Table</span>
              <p className="mt-1 text-lg font-semibold text-slate-200">{tournament.seatsPerTable}</p>
            </div>
          </div>
        )}

        {/* Discord Server Info */}
        {servers.length > 0 && (
          <div className="mt-6 border-t border-slate-800 pt-6">
            <div className="mb-2 text-xs font-medium text-slate-400">Registration Available From:</div>
            <div className="flex flex-wrap gap-2">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center gap-2 rounded bg-slate-800/50 px-3 py-1.5 text-xs"
                >
                  <img
                    src="/images/bux-poker.png"
                    alt={server.serverName}
                    className="h-4 w-4 rounded object-contain"
                  />
                  <span className="text-slate-300">{server.serverName}</span>
                  {server.inviteLink && (
                    <a
                      href={server.inviteLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
                    >
                      Join
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50">
        <div className="border-b border-slate-800">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('players')}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'players'
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Players {isCompleted && '(Final Standings)'}
            </button>
            <button
              onClick={() => setActiveTab('blinds')}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'blinds'
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Blind Levels
            </button>
            <button
              onClick={() => setActiveTab('prizes')}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'prizes'
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Prizes
            </button>
            {(isRunning || isSeated) && (
              <button
                onClick={() => setActiveTab('tables')}
                className={`px-6 py-3 text-sm font-medium transition-colors ${
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

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'players' && (
            <div className="space-y-3">
              {players.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No players registered yet.</p>
              ) : (
                players.map((player, index) => {
                  const place = player.position ?? index + 1;
                  const ordinal = place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
                  return (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 p-4 ${
                      user?.id === player.userId ? 'border-emerald-500/50 bg-emerald-500/5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {isCompleted && place && (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-slate-200">
                          {place}
                        </div>
                      )}
                      {!isCompleted && (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-sm font-medium text-slate-300">
                          {index + 1}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-slate-200">
                          {player.user.username}
                          {user?.id === player.userId && (
                            <span className="ml-2 text-xs text-emerald-400">(You)</span>
                          )}
                        </p>
                        {isRunning && (
                          <p className="text-xs text-slate-400">Status: {player.status}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {isCompleted ? (
                        <p className="font-semibold text-slate-200">
                          {ordinal}
                          {place === 1 && player.chips > 0 && (
                            <span className="ml-2 text-emerald-400 font-normal">({player.chips.toLocaleString()} chips)</span>
                          )}
                        </p>
                      ) : (
                        <>
                          <p className="font-semibold text-slate-200">
                            {player.chips.toLocaleString()} chips
                          </p>
                          {isRunning && player.position && (
                            <p className="text-xs text-slate-400">Position: {player.position}th</p>
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
            <div className="space-y-3">
              {blindLevels.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No blind levels configured.</p>
              ) : (
                blindLevels.map((level, index) => {
                  const isCurrent = isRunning && currentBlindLevel?.level === level.level;
                  return (
                    <div
                      key={level.level}
                      className={`rounded-lg border p-4 ${
                        isCurrent
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-slate-800 bg-slate-800/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200">Level {level.level}</span>
                            {isCurrent && (
                              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">
                                Current
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-lg font-bold text-slate-100">
                            {level.smallBlind} / {level.bigBlind}
                          </p>
                        </div>
                        <div className="text-right">
                          {level.duration === null ? (
                            <p className="text-sm font-medium text-slate-300">∞ Infinite</p>
                          ) : (
                            <p className="text-sm text-slate-400">{level.duration} min</p>
                          )}
                          {level.breakAfter && (
                            <p className="mt-1 text-xs text-slate-500">
                              {level.breakAfter} min break
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'prizes' && (
            <div className="text-center py-8">
              <p className="text-slate-400">Prize structure coming soon</p>
            </div>
          )}

          {activeTab === 'tables' && (
            <div className="space-y-4">
              {tables.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No tables created yet.</p>
              ) : (
                tables.map((table) => {
                  const activePlayers = table.players?.filter((p: any) => p.status !== 'ELIMINATED') ?? [];
                  const playerCount = activePlayers.length;
                  const isMyTable = myGameId === table.id;
                  return (
                    <div
                      key={table.id}
                      className={`rounded-lg border p-4 ${
                        isMyTable
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-slate-800 bg-slate-800/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-slate-200">
                            Table {table.tableNumber}
                            {isMyTable && (
                              <span className="ml-2 text-xs text-emerald-400">(Your Table)</span>
                            )}
                          </h3>
                          <p className="mt-1 text-sm text-slate-400">
                            {playerCount} / {tournament.seatsPerTable} players
                          </p>
                          {activePlayers.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {activePlayers.map((player: any) => (
                                <span
                                  key={player.id}
                                  className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300"
                                >
                                  {player.user?.username || 'Player'}
                                  {player.userId === user?.id && ' (You)'}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {isMyTable ? (
                            <button
                              onClick={() => {
                                const url = `/game/${table.id}`;
                                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
                                if (isMobile) {
                                  navigate(url);
                                } else {
                                  const winName = 'buxpoker-game-window';
                                  let w = window.open('', winName);
                                  if (w && !w.closed) {
                                    w.location.href = url;
                                    w.focus();
                                  } else {
                                    w = window.open(url, winName, 'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no');
                                    if (w) {
                                      w.focus();
                                      w.addEventListener('load', () => {
                                        setTimeout(() => {
                                          if (w?.document?.documentElement?.requestFullscreen) {
                                            w.document.documentElement.requestFullscreen().catch(() => {});
                                          }
                                        }, 500);
                                      });
                                    }
                                  }
                                }
                              }}
                              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                            >
                              Join Table
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                const url = `/game/${table.id}`;
                                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
                                if (isMobile) {
                                  navigate(url);
                                } else {
                                  const winName = 'buxpoker-game-window';
                                  let w = window.open('', winName);
                                  if (w && !w.closed) {
                                    w.location.href = url;
                                    w.focus();
                                  } else {
                                    w = window.open(url, winName, 'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no');
                                    if (w) {
                                      w.focus();
                                      w.addEventListener('load', () => {
                                        setTimeout(() => {
                                          if (w?.document?.documentElement?.requestFullscreen) {
                                            w.document.documentElement.requestFullscreen().catch(() => {});
                                          }
                                        }, 500);
                                      });
                                    }
                                  }
                                }
                              }}
                              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                            >
                              Watch
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

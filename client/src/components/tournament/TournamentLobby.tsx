import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTournament } from '../../hooks/useTournaments';
import { useAuth } from '@shared/features/auth/AuthContext';
import { useAdmin } from '../../hooks/useAdmin';
import { TournamentTimestamp } from './TournamentTimestamp';
import api from '../../services/api';

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
  const [tables, setTables] = useState<any[]>([]);
  const [myGameId, setMyGameId] = useState<string | null>(null);

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
          setTables(tournament.games);
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

  // Calculate running tournament stats
  useEffect(() => {
    if (!tournament || (tournament.status !== 'RUNNING' && tournament.status !== 'ACTIVE')) {
      return;
    }

    const updateRunningStats = () => {
      // Calculate running time - use startedAt if available, otherwise startTime
      const actualStartTime = (tournament as any).startedAt 
        ? new Date((tournament as any).startedAt) 
        : new Date(tournament.startTime);
      const now = new Date();
      const diff = now.getTime() - actualStartTime.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setRunningTime(`${hours}h ${minutes}m`);

      // TODO: Get current blind level from game state
      // For now, calculate based on running time and blind durations
      if (blindLevels.length > 0) {
        let elapsed = diff / 1000 / 60; // minutes
        let currentLevel = 0;
        for (let i = 0; i < blindLevels.length; i++) {
          const level = blindLevels[i];
          if (level.duration === null) {
            // Final level (infinite)
            currentLevel = i;
            break;
          }
          if (elapsed <= level.duration) {
            currentLevel = i;
            break;
          }
          elapsed -= level.duration;
          if (level.breakAfter) {
            elapsed -= level.breakAfter;
          }
        }
        
        if (currentLevel < blindLevels.length) {
          setCurrentBlindLevel(blindLevels[currentLevel]);
          
          // Get next level
          if (currentLevel + 1 < blindLevels.length) {
            setNextBlindLevel(blindLevels[currentLevel + 1]);
            // Calculate time until next level
            const currentLevelDuration = blindLevels[currentLevel].duration || 0;
            const breakDuration = blindLevels[currentLevel].breakAfter || 0;
            const timeUntilNext = (currentLevelDuration + breakDuration) * 60 * 1000 - (elapsed * 60 * 1000);
            if (timeUntilNext > 0) {
              const mins = Math.floor(timeUntilNext / (1000 * 60));
              setNextBlindIn(`${mins}m`);
            }
          } else {
            setNextBlindLevel(null);
          }
        }
      }

      // TODO: Get actual remaining players from game state
      // For now, use registered count as placeholder
      setRemainingPlayers(tournament.registeredCount || 0);

      // TODO: Get current position for logged-in user
      if (user) {
        // Placeholder - would need to query game state
        setCurrentPosition(null);
      }
    };

    updateRunningStats();
    const interval = setInterval(updateRunningStats, 1000);

    return () => clearInterval(interval);
  }, [tournament, blindLevels, user]);

  // Fetch players (registrations or active players)
  useEffect(() => {
    if (!tournament) return;

    const fetchPlayers = async () => {
      try {
        // If tournament is running/active, fetch from games
        // Otherwise, fetch from registrations
        if (tournament.status === 'RUNNING' || tournament.status === 'ACTIVE') {
          // TODO: Fetch active players with chip stacks from games
          // For now, show registered players
          const response = await api.get(`/api/tournaments/${id}`);
          if (response.data?.registrations) {
            const activePlayers = response.data.registrations
              .filter((r: any) => r.status === 'CONFIRMED')
              .map((r: any) => ({
                id: r.id,
                userId: r.userId,
                user: r.user,
                chips: tournament.startingChips, // Placeholder
                status: 'ACTIVE',
              }))
              .sort((a: Player, b: Player) => b.chips - a.chips);
            setPlayers(activePlayers);
          }
        } else if (tournament.status === 'COMPLETED') {
          // TODO: Fetch final standings
          const response = await api.get(`/api/tournaments/${id}`);
          if (response.data?.registrations) {
            const finalPlayers = response.data.registrations
              .filter((r: any) => r.status === 'CONFIRMED')
              .map((r: any, index: number) => ({
                id: r.id,
                userId: r.userId,
                user: r.user,
                chips: tournament.startingChips, // Placeholder - would be final chips
                status: 'COMPLETED',
                position: index + 1,
              }))
              .sort((a: Player, b: Player) => (a.position || 0) - (b.position || 0));
            setPlayers(finalPlayers);
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
    try {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        alert('Not authenticated');
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
      alert(err.response?.data?.error || 'Failed to start tournament');
      console.error('Error starting tournament:', err);
    } finally {
      setStartingTournament(false);
    }
  };

  const startTime = new Date(tournament.startTime);
  const registeredCount = tournament.registeredCount || 0;
  const isRunning = tournament.status === 'RUNNING' || tournament.status === 'ACTIVE';
  const isCompleted = tournament.status === 'COMPLETED';
  const isSeated = tournament.status === 'SEATED';
  const isRegistering = tournament.status === 'REGISTERING' || tournament.status === 'REGISTRATION' || tournament.status === 'SCHEDULED';
  const servers = tournament.servers || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/tournaments')}
          className="text-slate-400 hover:text-slate-200"
        >
          ← Back to Tournaments
        </button>
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
                Completed: {startTime.toLocaleString()}
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

        {/* Admin Actions */}
        {isAdmin && !isCompleted && (
          <div className="mt-4 flex gap-3 border-t border-slate-800 pt-4">
            {isRegistering && (
              <button
                onClick={handleCloseRegistration}
                disabled={closingRegistration}
                className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {closingRegistration ? 'Closing Registration...' : 'Close Registration & Seat Players'}
              </button>
            )}
            {isSeated && (
              <button
                onClick={handleStartTournament}
                disabled={startingTournament}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {startingTournament ? 'Starting Tournament...' : 'Start Tournament'}
              </button>
            )}
          </div>
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
                {remainingPlayers} / {tournament.maxPlayers}
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
                players.map((player, index) => (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 p-4 ${
                      user?.id === player.userId ? 'border-emerald-500/50 bg-emerald-500/5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {isCompleted && player.position && (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-slate-200">
                          {player.position}
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
                      <p className="font-semibold text-slate-200">
                        {player.chips.toLocaleString()} chips
                      </p>
                      {isRunning && player.position && (
                        <p className="text-xs text-slate-400">Position: {player.position}th</p>
                      )}
                    </div>
                  </div>
                ))
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
                  const playerCount = table.players?.length || 0;
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
                          {table.players && table.players.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {table.players.map((player: any) => (
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
                              onClick={() => window.open(`/game/${table.id}`, '_blank', 'width=1400,height=900')}
                              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                            >
                              Join Table
                            </button>
                          ) : (
                            <button
                              onClick={() => window.open(`/game/${table.id}`, '_blank', 'width=1400,height=900')}
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

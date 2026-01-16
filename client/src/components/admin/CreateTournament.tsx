import { useState, useEffect } from 'react';
import { useAuth } from '@shared/features/auth/AuthContext';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';

interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  duration: number | null; // null means infinite (final round)
  breakAfter?: number; // break duration in minutes (5, 10, or 15)
}

interface DiscordServer {
  id: string;
  serverId: string;
  serverName: string;
  inviteLink: string | null;
  setupCompleted: boolean;
  isBotMember: boolean;
}

export function CreateTournament() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [servers, setServers] = useState<DiscordServer[]>([]);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [loadingServers, setLoadingServers] = useState(true);

  // Initialize form data from URL params if present (for duplication)
  const getInitialFormData = () => {
    const name = searchParams.get('name') || '';
    const description = searchParams.get('description') || '';
    const maxPlayers = parseInt(searchParams.get('maxPlayers') || '100');
    const seatsPerTable = parseInt(searchParams.get('seatsPerTable') || '9');
    const startingChips = parseInt(searchParams.get('startingChips') || '10000');
    const prizePlaces = parseInt(searchParams.get('prizePlaces') || '3');
    
    return {
      name,
      description,
      startTime: '',
      maxPlayers,
      seatsPerTable,
      startingChips,
      prizePlaces,
    };
  };

  const getInitialBlindLevels = (): BlindLevel[] => {
    const blindLevelsParam = searchParams.get('blindLevels');
    if (blindLevelsParam) {
      try {
        const parsed = JSON.parse(blindLevelsParam);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse blind levels from URL:', e);
      }
    }
    return [
      { level: 1, smallBlind: 25, bigBlind: 50, duration: 10 },
      { level: 2, smallBlind: 50, bigBlind: 100, duration: 10 },
      { level: 3, smallBlind: 100, bigBlind: 200, duration: 10 },
      { level: 4, smallBlind: 150, bigBlind: 300, duration: 10 },
      { level: 5, smallBlind: 200, bigBlind: 400, duration: 10 },
      { level: 6, smallBlind: 250, bigBlind: 500, duration: 10, breakAfter: 5 },
      { level: 7, smallBlind: 300, bigBlind: 600, duration: 10 },
      { level: 8, smallBlind: 400, bigBlind: 800, duration: 10 },
      { level: 9, smallBlind: 500, bigBlind: 1000, duration: 10 },
      { level: 10, smallBlind: 600, bigBlind: 1200, duration: 10 },
      { level: 11, smallBlind: 750, bigBlind: 1500, duration: 10 },
      { level: 12, smallBlind: 1000, bigBlind: 2000, duration: 10, breakAfter: 5 },
      { level: 13, smallBlind: 1250, bigBlind: 2500, duration: 10 },
      { level: 14, smallBlind: 1500, bigBlind: 3000, duration: 10 },
      { level: 15, smallBlind: 2000, bigBlind: 4000, duration: 10 },
      { level: 16, smallBlind: 2500, bigBlind: 5000, duration: 10 },
      { level: 17, smallBlind: 3000, bigBlind: 6000, duration: 10 },
      { level: 18, smallBlind: 4000, bigBlind: 8000, duration: 10, breakAfter: 5 },
      { level: 19, smallBlind: 5000, bigBlind: 10000, duration: null }, // Infinite
    ];
  };

  const getInitialBlindRoundDuration = () => {
    const blindLevels = getInitialBlindLevels();
    if (blindLevels.length > 0 && blindLevels[0].duration !== null) {
      return blindLevels[0].duration;
    }
    return 15;
  };

  const [formData, setFormData] = useState(getInitialFormData());
  const [blindRoundDuration, setBlindRoundDuration] = useState(getInitialBlindRoundDuration());
  const [blindLevels, setBlindLevels] = useState<BlindLevel[]>(getInitialBlindLevels());

  const startingChipsOptions = [1000, 2000, 5000, 10000, 20000, 50000, 100000];

  // Clear URL params after loading (for cleaner URLs)
  useEffect(() => {
    if (searchParams.toString()) {
      // Keep the params for now, user can clear them manually or we clear on submit
    }
  }, [searchParams]);

  useEffect(() => {
    // Fetch available Discord servers
    const fetchServers = async () => {
      try {
        const token = localStorage.getItem('sessionToken');
        if (!token) return;

        const response = await api.get('/api/admin/servers', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setServers(response.data || []);
      } catch (err) {
        console.error('Failed to fetch servers:', err);
      } finally {
        setLoadingServers(false);
      }
    };

    if (user) {
      fetchServers();
    }
  }, [user]);

  const toggleServerSelection = (serverId: string) => {
    setSelectedServerIds((prev) =>
      prev.includes(serverId)
        ? prev.filter((id) => id !== serverId)
        : [...prev, serverId]
    );
  };

  if (!user) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
        <p className="text-slate-400">Please log in to create tournaments.</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Apply single duration to all rounds except the final one (which is infinite)
      const blindLevelsWithDuration = blindLevels.map((level, index) => ({
        ...level,
        duration: index === blindLevels.length - 1 ? null : blindRoundDuration,
      }));

      const response = await api.post(
        '/api/admin/tournaments',
        {
          ...formData,
          blindLevelsJson: JSON.stringify(blindLevelsWithDuration),
          serverIds: selectedServerIds, // Include selected Discord servers
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data) {
        setSuccess(true);
        // Clear URL params
        setSearchParams({});
        // Reset form
        setFormData({
          name: '',
          description: '',
          startTime: '',
          maxPlayers: 100,
          seatsPerTable: 9,
          startingChips: 10000,
          prizePlaces: 3,
        });
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to create tournament');
    } finally {
      setLoading(false);
    }
  };

  const addBlindLevel = () => {
    const lastLevel = blindLevels[blindLevels.length - 1];
    // When adding a new level, make the previous last level non-infinite
    const updatedLevels = blindLevels.map((level, index) => {
      if (index === blindLevels.length - 1) {
        return { ...level, duration: blindRoundDuration }; // Make previous final round use the standard duration
      }
      return level;
    });
    
    setBlindLevels([
      ...updatedLevels,
      {
        level: lastLevel.level + 1,
        smallBlind: lastLevel.bigBlind,
        bigBlind: lastLevel.bigBlind * 2,
        duration: null, // New final round is infinite
      },
    ]);
  };

  const removeBlindLevel = (index: number) => {
    if (blindLevels.length > 1) {
      setBlindLevels(blindLevels.filter((_, i) => i !== index));
    }
  };

  const updateBlindLevel = (index: number, field: keyof BlindLevel, value: number | null) => {
    const updated = [...blindLevels];
    updated[index] = { ...updated[index], [field]: value };
    setBlindLevels(updated);
  };

  const updateBlindLevelBreak = (index: number, breakDuration: number | undefined) => {
    const updated = [...blindLevels];
    if (breakDuration) {
      updated[index] = { ...updated[index], breakAfter: breakDuration };
    } else {
      const { breakAfter, ...rest } = updated[index];
      updated[index] = rest as BlindLevel;
    }
    setBlindLevels(updated);
  };

  // Update durations when blindRoundDuration changes (except final round)
  const handleBlindRoundDurationChange = (newDuration: number) => {
    setBlindRoundDuration(newDuration);
    setBlindLevels(blindLevels.map((level, index) => {
      if (index === blindLevels.length - 1) {
        return level; // Keep final round as infinite
      }
      return { ...level, duration: newDuration };
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create Tournament</h1>
        <p className="mt-1 text-sm text-slate-400">
          Set up a new Texas Hold'em tournament
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Basic Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Tournament Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
                placeholder="Weekly Tournament #1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
                rows={3}
                placeholder="Tournament description..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">
                Start Time *
              </label>
              <input
                type="datetime-local"
                required
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Tournament Settings */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Tournament Settings</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Max Players
              </label>
              <input
                type="number"
                min="2"
                value={formData.maxPlayers}
                onChange={(e) =>
                  setFormData({ ...formData, maxPlayers: parseInt(e.target.value) })
                }
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">
                Seats Per Table
              </label>
              <input
                type="number"
                min="2"
                max="10"
                value={formData.seatsPerTable}
                onChange={(e) =>
                  setFormData({ ...formData, seatsPerTable: parseInt(e.target.value) })
                }
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">
                Starting Chips
              </label>
              <select
                value={formData.startingChips}
                onChange={(e) =>
                  setFormData({ ...formData, startingChips: parseInt(e.target.value) })
                }
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {startingChipsOptions.map((chips) => (
                  <option key={chips} value={chips}>
                    {chips.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">
                Prize Places
              </label>
              <input
                type="number"
                min="1"
                value={formData.prizePlaces}
                onChange={(e) =>
                  setFormData({ ...formData, prizePlaces: parseInt(e.target.value) })
                }
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Blind Levels */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Blind Levels</h2>
            <button
              type="button"
              onClick={addBlindLevel}
              className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              + Add Level
            </button>
          </div>
          
          {/* Single Duration Input for All Rounds */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300">
              Blind Round Duration (minutes) - applies to all rounds except final
            </label>
            <input
              type="number"
              min="1"
              value={blindRoundDuration}
              onChange={(e) => handleBlindRoundDurationChange(parseInt(e.target.value))}
              className="mt-1 w-full max-w-xs rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-3">
            {blindLevels.map((level, index) => {
              const isFinalRound = index === blindLevels.length - 1;
              return (
                <div
                  key={index}
                  className="rounded border border-slate-700 bg-slate-800/50 p-3"
                >
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-16 text-sm font-medium text-slate-300">
                      Level {level.level}
                      {isFinalRound && <span className="block text-xs text-emerald-400">∞ Final</span>}
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-xs text-slate-400">Small Blind</label>
                      <input
                        type="number"
                        min="1"
                        value={level.smallBlind}
                        onChange={(e) =>
                          updateBlindLevel(index, 'smallBlind', parseInt(e.target.value))
                        }
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-xs text-slate-400">Big Blind</label>
                      <input
                        type="number"
                        min="1"
                        value={level.bigBlind}
                        onChange={(e) =>
                          updateBlindLevel(index, 'bigBlind', parseInt(e.target.value))
                        }
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div className="w-32">
                      <label className="block text-xs text-slate-400">Duration</label>
                      <div className="mt-1 flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100">
                        {isFinalRound ? (
                          <span className="text-emerald-400 font-medium">∞ Infinite</span>
                        ) : (
                          <span>{level.duration} min</span>
                        )}
                      </div>
                    </div>
                    <div className="w-32">
                      <label className="block text-xs text-slate-400">Break After</label>
                      <select
                        value={level.breakAfter || ''}
                        onChange={(e) => {
                          const value = e.target.value ? parseInt(e.target.value) : undefined;
                          updateBlindLevelBreak(index, value);
                        }}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="">No break</option>
                        <option value="5">5 minutes</option>
                        <option value="10">10 minutes</option>
                        <option value="15">15 minutes</option>
                      </select>
                    </div>
                    {blindLevels.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBlindLevel(index)}
                        className="rounded bg-red-600 px-3 py-1 text-xs text-white transition-colors hover:bg-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Discord Server Selection */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Discord Servers</h2>
          <p className="mb-4 text-sm text-slate-400">
            Select which Discord servers to post this tournament to. Servers must be set up with /setup command first.
          </p>
          {loadingServers ? (
            <p className="text-slate-400">Loading servers...</p>
          ) : servers.length === 0 ? (
            <p className="text-slate-400">
              No Discord servers configured. Use /setup command in your Discord server to configure it first.
            </p>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <label
                  key={server.id}
                  className={`flex cursor-pointer items-center gap-3 rounded border p-3 transition-colors ${
                    !server.isBotMember || !server.setupCompleted
                      ? 'border-slate-700 bg-slate-800/30 opacity-50'
                      : selectedServerIds.includes(server.serverId)
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedServerIds.includes(server.serverId)}
                    onChange={() => toggleServerSelection(server.serverId)}
                    disabled={!server.isBotMember || !server.setupCompleted}
                    className="h-4 w-4 rounded border-slate-600 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{server.serverName}</span>
                      {!server.isBotMember && (
                        <span className="text-xs text-amber-400">(Bot not in server)</span>
                      )}
                      {!server.setupCompleted && (
                        <span className="text-xs text-amber-400">(Setup incomplete)</span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-red-200">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-200">
            Tournament created successfully!
            {selectedServerIds.length > 0 && (
              <span className="block mt-2 text-sm">
                Tournament embed posted to {selectedServerIds.length} Discord server(s).
              </span>
            )}
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-6 py-2 font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Tournament'}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSocket } from "../../services/socket";
import { PokerTable } from "../../components/poker/PokerTable";
import type { Card } from "@shared/types/poker";
import { BettingControls } from "../../components/poker/BettingControls";
import { useAuth } from "@shared/features/auth/AuthContext";
import Chat from "@shared/components/chat/Chat";
import type { Player } from "@shared/types/game";
import PlayerStatsModal from "../../components/modals/PlayerStatsModal";
import { api } from "../../services/api";
import { useTournament } from "../../hooks/useTournaments";
import { soundManager, type SoundName } from "../../utils/soundManager";

interface PlayerViewModel {
  id: string;
  name: string;
  chips: number;
  seatNumber: number;
  status: string;
  holeCards?: Card[];
  avatarUrl?: string;
  userId?: string;
  contribution?: number;
}

interface GameStatePayload {
  id: string;
  tournamentId?: string;
  tableNumber?: number;
  pot: number;
  communityCards: string;
  players: PlayerViewModel[];
  smallBlind?: number;
  bigBlind?: number;
  dealerSeat?: number;
  smallBlindSeat?: number;
  bigBlindSeat?: number;
  currentTurnUserId?: string;
  street?: string;
  currentBet?: number;
  minimumRaise?: number;
  showdownActive?: boolean;
  showdownResults?: any;
}

function parseCommunityCards(encoded: string): Card[] {
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(encoded);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

// Helper to play sound effects using queued playback to avoid overlaps
function playSound(soundNameOrFile: string, volume: number = 0.7) {
  if (typeof window === 'undefined') return;

  // Support old file-based calls for backward compatibility
  const legacyMap: Record<string, SoundName> = {
    'turn.mp3': 'your-turn',
    'fold.wav': 'fold',
    'bet.wav': 'bet',
    'check.wav': 'check',
  };

  let soundName: SoundName;
  if ((soundNameOrFile as SoundName) in SOUND_CONFIGS) {
    soundName = soundNameOrFile as SoundName;
  } else if (legacyMap[soundNameOrFile]) {
    soundName = legacyMap[soundNameOrFile];
  } else {
    soundName = soundNameOrFile.replace(/\.(mp3|wav)$/, '') as SoundName;
  }

  soundManager.playQueued(soundName, volume);
}

export function PokerGameView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gameState, setGameState] = useState<GameStatePayload | null>(null);
  const [prevGameState, setPrevGameState] = useState<GameStatePayload | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [turnTimer, setTurnTimer] = useState<{ userId: string; expiresAt: number; duration: number } | null>(null);
  const [nextBlindTime, setNextBlindTime] = useState<string>('--:--');
  const [isPortrait, setIsPortrait] = useState(false);
  const [showdownResults, setShowdownResults] = useState<any>(null);
  const [showDealerMessages, setShowDealerMessages] = useState(true);
  const [tournamentCountdown, setTournamentCountdown] = useState<{ startTime: string; seconds: number } | null>(null);
  const [eliminationInfo, setEliminationInfo] = useState<{ place: number | null } | null>(null);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);
  const [consolidationWaiting, setConsolidationWaiting] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isMobileWidth, setIsMobileWidth] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  const chatCollapsedRef = useRef(chatCollapsed);
  const { user } = useAuth();

  chatCollapsedRef.current = chatCollapsed;
  const { tournament, refetch: refetchTournament } = useTournament(gameState?.tournamentId);

  // Mobile width detection for collapsible chat
  useEffect(() => {
    const check = () => setIsMobileWidth(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Keep tournament data fresh (remainingPlayers, etc.) when in active game (silent = no loading flash)
  useEffect(() => {
    if (!gameState?.tournamentId || !tournament) return;
    const interval = setInterval(() => refetchTournament({ silent: true }), 10000);
    return () => clearInterval(interval);
  }, [gameState?.tournamentId, tournament, refetchTournament]);
  const lastTournamentStatusRef = useRef<string | null>(null);
  const lastPlayerStatusRef = useRef<string | null>(null);
  
  // Request fullscreen on load to hide browser bar
  useEffect(() => {
    const requestFullscreen = async () => {
      try {
        // Check if we're in a popup window (opened from tournament lobby)
        const isPopup = window.opener !== null;
        
        if (isPopup) {
          // Wait a bit for window to fully load
          setTimeout(async () => {
            try {
              if (document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
              } else if ((document.documentElement as any).webkitRequestFullscreen) {
                // Safari
                await (document.documentElement as any).webkitRequestFullscreen();
              } else if ((document.documentElement as any).mozRequestFullScreen) {
                // Firefox
                await (document.documentElement as any).mozRequestFullScreen();
              } else if ((document.documentElement as any).msRequestFullscreen) {
                // IE/Edge
                await (document.documentElement as any).msRequestFullscreen();
              }
            } catch (err) {
              // User denied fullscreen or not supported - that's ok
              console.log('[FULLSCREEN] Fullscreen request denied or not supported');
            }
          }, 1000);
        }
      } catch (err) {
        // Ignore errors
      }
    };

    requestFullscreen();
  }, []);

  // Check screen orientation
  useEffect(() => {
    const checkOrientation = () => {
      const isPortraitMode = window.innerHeight > window.innerWidth;
      setIsPortrait(isPortraitMode);
    };
    
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);
  
  // Refetch tournament data when gameState changes to get updated status/startedAt
  useEffect(() => {
    if (gameState?.tournamentId) {
      // Refetch tournament data whenever gameState.tournamentId changes
      refetchTournament();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.tournamentId]); // refetchTournament is stable (memoized), so we can omit it
  
  // Also refetch periodically if tournament is SEATED but hasn't started yet (waiting for 2-minute countdown)
  // Track polling state with a ref to prevent unnecessary refetches
  const pollingActiveRef = useRef(false);
  
  useEffect(() => {
    // Only poll if tournament is SEATED (waiting to start) and hasn't started yet
    const shouldPoll = gameState?.tournamentId && tournament?.status === 'SEATED' && !tournament.startedAt;
    
    if (shouldPoll) {
      pollingActiveRef.current = true;
      
      // Refetch every 5 seconds if tournament is SEATED and hasn't started yet (during 2-minute countdown)
      const interval = setInterval(() => {
        // Double-check condition before refetching (tournament might have started)
        // This prevents unnecessary refetches if the tournament already started
        if (!pollingActiveRef.current) {
          return; // Polling was stopped, don't refetch
        }
        
        console.log('[BLIND TIMER] Refetching tournament data to check for startedAt...');
        refetchTournament({ silent: true }).then(() => {
          // After refetch, the tournament object will be updated and this useEffect will re-run
          // If tournament.startedAt is now set, the interval will be cleared
        }).catch((err) => {
          // Silently ignore refetch errors (they're expected during normal operation)
          if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED' && err.message !== 'Request aborted') {
            console.error('[BLIND TIMER] Error refetching tournament:', err);
          }
        });
      }, 5000); // Increased to 5 seconds to reduce polling frequency
      
      return () => {
        pollingActiveRef.current = false;
        clearInterval(interval);
      };
    } else {
      // Tournament has started or status changed - stop polling
      pollingActiveRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.tournamentId, tournament?.status, tournament?.startedAt]); // refetchTournament is stable (memoized), so we can omit it

  useEffect(() => {
    if (!id) return;

    const socket = getSocket();
    
    // Listen for tournament-started socket event to refetch immediately
    const handleTournamentStarted = (data: { tournamentId: string; startedAt: string }) => {
      if (data.tournamentId === gameState?.tournamentId || data.tournamentId === tournament?.id) {
        console.log('[BLIND TIMER] Tournament started event received, refetching tournament data...');
        // Stop polling immediately when tournament starts
        pollingActiveRef.current = false;
        refetchTournament();
      }
    };
    
    socket.on('tournament-started', handleTournamentStarted);
    
    // Ensure socket is connected
    if (!socket.connected) {
      socket.connect();
    }

    // Use default namespace - backend handles routing
    socket.emit("join-table", { gameId: id });

    socket.on("game-state", (payload: GameStatePayload) => {
      // Ignore game-state for other tables (user may receive stale msgs if room leave was delayed)
      if (payload.id && id && payload.id !== id) return;
      setGameState((prev) => {
        // Store previous state before updating
        if (prev) {
          setPrevGameState(prev);
        }
        return payload;
      });
      // Clear showdown styling when new hand starts (no showdownActive / PREFLOP)
      if (!payload.showdownActive && (payload.street === "PREFLOP" || !payload.street)) {
        setShowdownResults(null);
      }
      setConsolidationWaiting(null);
      setConnecting(false);
      setError(null);
    });

    socket.on("error", (payload: { message: string }) => {
      setError(payload.message);
      setConnecting(false);
    });

    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("join-table", { gameId: id });
    });
    socket.on("disconnect", () => {
      setSocketConnected(false);
    });
    setSocketConnected(socket.connected);

    socket.on("game_message", (data: { gameId: string; message: any }) => {
      // Ensure we have the correct structure
      const messageData = data.message || data;
      // Dispatch a custom event to be caught by ChatHooks
      window.dispatchEvent(new CustomEvent('gameMessage', { detail: { gameId: id, message: messageData } }));
      // If chat is collapsed on mobile and message is from another user (not dealer), increment unread
      const isUserChat = messageData && !messageData.isDealerMessage && messageData.userId !== 'DEALER' && messageData.userId !== user?.id;
      if (isUserChat && chatCollapsedRef.current && window.innerWidth <= 768) {
        setUnreadChatCount((c) => c + 1);
      }
    });

    socket.on("turn-timer-start", (payload: { gameId: string; userId: string; expiresAt: number; duration: number }) => {
      if (payload.gameId === id) {
        setTurnTimer({ userId: payload.userId, expiresAt: payload.expiresAt, duration: payload.duration });
      }
    });

    socket.on("showdown", (payload: { gameId: string; results: any }) => {
      if (payload.gameId === id) {
        setShowdownResults(payload.results);
        // Play showdown sound
        soundManager.play('showdown');
        // Clear after 8 seconds
        setTimeout(() => setShowdownResults(null), 8000);
      }
    });

    socket.on("consolidation-waiting", (payload: { message: string; tournamentId: string }) => {
      setConsolidationWaiting(payload.message);
    });

    socket.on("tournament_updated", () => {
      setConsolidationWaiting(null);
      refetchTournament({ silent: true });
    });
    // Only redirect when tables were rebalanced (consolidation), not on every tournament_updated
    socket.on("consolidation-complete", async (payload: { tournamentId: string }) => {
      if (payload.tournamentId !== gameState?.tournamentId && payload.tournamentId !== tournament?.id) return;
      refetchTournament({ silent: true });
      if (!user?.id) return;
      try {
        const { data: t } = await api.get(`/api/tournaments/${payload.tournamentId}`);
        const myEntry = (t?.players || []).find((p: any) => p.userId === user.id);
        if (myEntry?.gameId && myEntry.gameId !== id) {
          navigate(`/game/${myEntry.gameId}`, { replace: true });
        }
      } catch {
        // ignore
      }
    });

    socket.on("winner", (payload: { gameId: string; winners: any[] }) => {
      if (payload.gameId === id) {
        // Check if current user won
        const myPlayerWon = payload.winners.some((w: any) => w.userId === user?.id || w.playerId === user?.id);
        if (myPlayerWon) {
          soundManager.play('pot-win');
        }
      }
    });

    // Listen for tournament starting countdown
    socket.on("tournament-starting", (payload: { tournamentId: string; startTime: string; countdownSeconds: number }) => {
      console.log('[TOURNAMENT COUNTDOWN] Received tournament-starting event:', payload);
      // Check if this tournament matches our game (check both gameState and tournament object)
      const matchesGameState = payload.tournamentId === gameState?.tournamentId;
      const matchesTournament = payload.tournamentId === tournament?.id;
      
      if (matchesGameState || matchesTournament) {
        console.log('[TOURNAMENT COUNTDOWN] Setting countdown:', payload);
        setTournamentCountdown({
          startTime: payload.startTime,
          seconds: payload.countdownSeconds
        });
      } else {
        console.log('[TOURNAMENT COUNTDOWN] Tournament ID mismatch:', {
          payloadTournamentId: payload.tournamentId,
          gameStateTournamentId: gameState?.tournamentId,
          tournamentId: tournament?.id
        });
      }
    });

    // Listen for tournament started (clear countdown)
    socket.on("tournament-started", (payload: { tournamentId: string }) => {
      // Check if this tournament matches our game (check both gameState and tournament object)
      const matchesGameState = payload.tournamentId === gameState?.tournamentId;
      const matchesTournament = payload.tournamentId === tournament?.id;
      
      if (matchesGameState || matchesTournament) {
        console.log('[TOURNAMENT COUNTDOWN] Tournament started, clearing countdown');
        setTournamentCountdown(null);
        soundManager.play('tournament-start');
      }
    });

    // Tournament ended – refetch so winner modal and COMPLETED status show
    socket.on("tournament_completed", (payload: { tournamentId: string }) => {
      if (payload.tournamentId === gameState?.tournamentId || payload.tournamentId === tournament?.id) {
        refetchTournament();
      }
    });

    // Update timer every second to keep it synced
    const timerInterval = setInterval(() => {
      setTurnTimer((prev) => {
        if (prev) {
          const remaining = prev.expiresAt - Date.now();
          if (remaining <= 0) {
            return null;
          }
        }
        return prev;
      });
    }, 100);

    return () => {
      socket.off("game-state");
      socket.off("error");
      socket.off("connect");
      socket.off("disconnect");
      socket.off("game_message");
      socket.off("turn-timer-start");
      socket.off("showdown");
      socket.off("consolidation-waiting");
      socket.off("tournament_updated");
      socket.off("consolidation-complete");
      socket.off("winner");
      socket.off("tournament-starting");
      socket.off("tournament-started");
      socket.off("tournament_completed");
      clearInterval(timerInterval);
    };
  }, [id, turnTimer, gameState?.tournamentId, tournament?.id, user?.id]);

  // Update countdown timer every second (separate from socket setup).
  // IMPORTANT: Countdown is driven only by server \"tournament-starting\" /
  // \"tournament-started\" events. We do NOT create local fallbacks here, to
  // avoid the overlay reappearing after the game has begun.
  useEffect(() => {
    if (!tournamentCountdown) return;

    const interval = setInterval(() => {
      const now = new Date();
      const startTime = new Date(tournamentCountdown.startTime);
      const remaining = Math.max(0, Math.floor((startTime.getTime() - now.getTime()) / 1000));

      if (remaining <= 0) {
        setTournamentCountdown(null);
        clearInterval(interval);
      } else {
        setTournamentCountdown(prev => prev ? { ...prev, seconds: remaining } : null);
      }
    }, 1000); // update once per second

    return () => clearInterval(interval);
  }, [tournamentCountdown]);

  // When tournament is SEATED and server has startScheduledAt (host clicked Start), show countdown
  // so the table shows the timer even if the socket event was missed (e.g. tab opened after click).
  useEffect(() => {
    if (!tournament || tournament.status !== 'SEATED') return;
    const scheduledAt = (tournament as any).startScheduledAt;
    if (!scheduledAt) return;
    const startTime = new Date(scheduledAt);
    const now = Date.now();
    if (startTime.getTime() <= now) return;
    const seconds = Math.max(0, Math.floor((startTime.getTime() - now) / 1000));
    setTournamentCountdown(prev => {
      if (prev && prev.startTime === startTime.toISOString()) return prev;
      return { startTime: startTime.toISOString(), seconds };
    });
  }, [tournament?.status, (tournament as any)?.startScheduledAt]);

  // Calculate next blind timer based on tournament.startedAt and blind level durations
  useEffect(() => {
    if (!tournament) {
      setNextBlindTime('--:--');
      return;
    }
    
    if (!tournament.startedAt) {
      setNextBlindTime('--:--');
      return;
    }
    
    // Timer only works when tournament is RUNNING/ACTIVE (after Start Tournament is clicked)
    // This sets startedAt and status to RUNNING (or ACTIVE in some flows)
    if (tournament.status !== 'RUNNING' && tournament.status !== 'ACTIVE') {
      setNextBlindTime('--:--');
      return;
    }
    
    const calculateNextBlind = () => {
      if (!tournament.startedAt) {
        setNextBlindTime('--:--');
        return;
      }
      
      const now = new Date();
      const startedAt = new Date(tournament.startedAt);
      const elapsedMs = now.getTime() - startedAt.getTime();
      let elapsedMinutes = elapsedMs / 1000 / 60;
      
      if (elapsedMs < 0) {
        // Tournament hasn't started yet
        setNextBlindTime('--:--');
        return;
      }

      // Support both parsed arrays (from API) and raw JSON strings
      let blindLevels: any[] = [];
      try {
        if (Array.isArray(tournament.blindLevels)) {
          blindLevels = tournament.blindLevels;
        } else if (typeof tournament.blindLevels === 'string') {
          blindLevels = JSON.parse(tournament.blindLevels || '[]');
        }
      } catch (e) {
        console.error('[BLIND TIMER] Failed to parse blindLevels in PokerGameView:', e);
        blindLevels = [];
      }
      if (blindLevels.length === 0) {
        setNextBlindTime('--:--');
        return;
      }

      // Find current blind level and minutes into that level (ignore breaks for timer simplicity)
      let currentLevelIndex = 0;
      let minutesIntoCurrentLevel = elapsedMinutes;
      for (let i = 0; i < blindLevels.length; i++) {
        const level = blindLevels[i];
        if (level.duration === null) {
          // Final level (infinite duration)
          currentLevelIndex = i;
          minutesIntoCurrentLevel = 0;
          break;
        }
        const levelDuration = level.duration || 0;
        if (minutesIntoCurrentLevel <= levelDuration) {
          currentLevelIndex = i;
          break;
        }
        minutesIntoCurrentLevel -= levelDuration;
      }

      // Calculate time until next level (based only on level.duration)
      if (currentLevelIndex + 1 < blindLevels.length) {
        const currentLevel = blindLevels[currentLevelIndex];
        const levelDuration = currentLevel.duration || 0;
        const remainingMinutes = Math.max(0, levelDuration - minutesIntoCurrentLevel);
        const timeUntilNext = remainingMinutes * 60 * 1000;

        if (timeUntilNext > 0) {
          const minutes = Math.floor(timeUntilNext / 60000);
          const seconds = Math.floor((timeUntilNext % 60000) / 1000);
          setNextBlindTime(`${minutes}:${seconds.toString().padStart(2, '0')}`);
        } else {
          setNextBlindTime('0:00');
        }
      } else {
        // Final level
        setNextBlindTime('∞');
      }
    };

    calculateNextBlind();
    const interval = setInterval(calculateNextBlind, 1000); // Update every second

    return () => clearInterval(interval);
  }, [tournament]);

  // Detect when the local user is eliminated from the tournament or wins it,
  // and show a simple modal with their final position / winner announcement.
  useEffect(() => {
    if (!tournament || !user) return;

    const anyTournament: any = tournament as any;
    const players: any[] = anyTournament.players || [];
    if (!Array.isArray(players) || players.length === 0) {
      return;
    }

    const me = players.find(p => p.userId === user.id);
    const currentStatus: string | null = me?.status || null;

    const prevStatus = lastPlayerStatusRef.current;
    lastPlayerStatusRef.current = currentStatus;
    lastTournamentStatusRef.current = tournament.status;

    // Show elimination modal once when the player transitions to ELIMINATED
    if (currentStatus === 'ELIMINATED' && prevStatus && prevStatus !== 'ELIMINATED') {
      const place: number | null = typeof me?.finishingPlace === 'number'
        ? me.finishingPlace
        : (typeof me?.position === 'number' ? me.position : null);
      setEliminationInfo({ place });
    }

    // Show winner modal when tournament is completed and this player finished 1st
    const finishedFirst =
      (tournament.status === 'COMPLETED') &&
      me &&
      (me.finishingPlace === 1 || me.position === 1);

    if (finishedFirst && !winnerModalOpen) {
      setWinnerModalOpen(true);
    }
  }, [tournament, user, winnerModalOpen]);

  // Sound effects: Play sounds when game state changes
  useEffect(() => {
    if (!gameState || !prevGameState || !user) return;

    // 1. Turn sound: Play when it becomes my turn
    const prevWasMyTurn = prevGameState.currentTurnUserId === user.id;
    const nowIsMyTurn = gameState.currentTurnUserId === user.id;
    if (!prevWasMyTurn && nowIsMyTurn) {
      soundManager.play('your-turn');
    }

    // 2. Street changes (dealer actions)
    const prevStreet = prevGameState.street || 'PREFLOP';
    const currentStreet = gameState.street || 'PREFLOP';
    if (prevStreet !== currentStreet) {
      if (currentStreet === 'FLOP') {
        soundManager.play('deal-flop');
      } else if (currentStreet === 'TURN') {
        soundManager.play('deal-turn');
      } else if (currentStreet === 'RIVER') {
        soundManager.play('deal-river');
      }
    }

    // 3. Showdown
    const prevShowdown = prevGameState.showdownActive || false;
    const currentShowdown = gameState.showdownActive || false;
    if (!prevShowdown && currentShowdown) {
      soundManager.play('showdown');
    }

    // 4. New hand start (detected by street resetting to PREFLOP and pot resetting)
    const prevPot = prevGameState.pot || 0;
    const currentPot = gameState.pot || 0;
    if (prevPot > 0 && currentPot === 0 && currentStreet === 'PREFLOP' && prevStreet !== 'PREFLOP') {
      soundManager.play('hand-start');
    }

    // 5. Detect player actions by comparing previous and current state
    const prevPlayers = new Map(prevGameState.players.map(p => [p.id, p]));
    
    gameState.players.forEach(currentPlayer => {
      const prevPlayer = prevPlayers.get(currentPlayer.id);
      if (!prevPlayer) return;

      // Skip if this is me (don't play sounds for my own actions)
      const isMyPlayer = currentPlayer.userId === user.id || currentPlayer.id === user.id;

      // Fold sound: Player status changed to FOLDED
      if (prevPlayer.status !== 'FOLDED' && currentPlayer.status === 'FOLDED') {
        if (!isMyPlayer) {
          soundManager.play('fold');
        }
        return;
      }

      // Skip further checks if player folded
      if (currentPlayer.status === 'FOLDED') return;

      const prevContribution = prevPlayer.contribution || 0;
      const currentContribution = currentPlayer.contribution || 0;
      const prevChips = prevPlayer.chips || 0;
      const currentChips = currentPlayer.chips || 0;
      const contributionIncreased = currentContribution > prevContribution;
      const wentAllIn = prevChips > 0 && currentChips === 0 && contributionIncreased;

      // All-in sound (highest priority)
      if (wentAllIn && !isMyPlayer) {
        soundManager.play('allin');
        return;
      }

      // Bet/Call/Raise detection
      if (contributionIncreased && currentPlayer.status === 'ACTIVE' && !isMyPlayer) {
        const prevBet = prevGameState.currentBet || 0;
        const currentBet = gameState.currentBet || 0;
        const wasCurrentTurn = prevGameState.currentTurnUserId === currentPlayer.userId || prevGameState.currentTurnUserId === currentPlayer.id;
        
        // Raise: Bet increased and this player was the one who raised
        if (currentBet > prevBet && wasCurrentTurn) {
          soundManager.play('raise');
        }
        // Call: Bet exists and player matched it
        else if (currentBet > 0 && currentContribution === currentBet) {
          soundManager.play('call');
        }
        // Bet: New bet placed (no previous bet)
        else if (prevBet === 0 && currentBet > 0) {
          soundManager.play('bet');
        }
        // Default to call if we can't determine
        else {
          soundManager.play('call');
        }
        return;
      }

      // Check sound: Player was the current turn, now they're not, contribution didn't change, and currentBet is 0
      const wasCurrentTurn = prevGameState.currentTurnUserId === currentPlayer.userId || prevGameState.currentTurnUserId === currentPlayer.id;
      const isNotCurrentTurn = gameState.currentTurnUserId !== currentPlayer.userId && gameState.currentTurnUserId !== currentPlayer.id;
      const contributionUnchanged = currentContribution === prevContribution;
      const noCurrentBet = (gameState.currentBet || 0) === 0;
      
      if (wasCurrentTurn && isNotCurrentTurn && contributionUnchanged && noCurrentBet && currentPlayer.status === 'ACTIVE' && !isMyPlayer) {
        soundManager.play('check');
      }
    });

    // 6. Pot win detection (showdown results)
    const prevShowdownResults = prevGameState.showdownResults;
    const currentShowdownResults = gameState.showdownResults;
    if (!prevShowdownResults && currentShowdownResults) {
      const winners = currentShowdownResults.winners || [];
      const myPlayerWon = winners.some((w: any) => w.userId === user.id || w.playerId === user.id);
      if (myPlayerWon) {
        soundManager.play('pot-win');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, user]); // Only run when gameState changes, prevGameState is captured in closure

  const handleAction = (action: string, amount: number) => {
    if (!id || !gameState || !user) return;
    const socket = getSocket();
    socket.emit("player-action", {
      gameId: id,
      userId: user.id,
      action,
      amount
    });
  };

  if (!id) {
    return (
      <div className="text-red-400">
        Invalid game id
      </div>
    );
  }

  if (connecting) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Connecting to table...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-200">
        {error}
      </div>
    );
  }

  if (!gameState) {
    return null;
  }

  const communityCards = parseCommunityCards(gameState.communityCards);

  // Convert players to format expected by Chat component
  const chatPlayers: Player[] = gameState.players.map((p) => ({
    id: p.id,
    userId: p.id, // Assuming player id maps to userId for now
    name: p.name,
    team: 1, // Default team for poker (not team-based)
    position: p.seatNumber, // Use seatNumber as position
    seatIndex: p.seatNumber - 1, // Convert to 0-based index
    isDealer: p.seatNumber === gameState.dealerSeat,
    hand: [], // Poker hands are separate from player list
    avatarUrl: undefined,
    isBot: false,
    chips: p.chips,
    seatNumber: p.seatNumber,
    status: p.status as any,
  }));

  const smallBlind = gameState.smallBlind || 10;
  const bigBlind = gameState.bigBlind || 20;
  const activePlayers = gameState.players.filter(p => p.status !== 'ELIMINATED');
  const myPlayer = gameState.players.find(p => p.userId === user?.id || p.id === user?.id);
  
  // Tournament player counts for header
  const tournamentRemainingPlayers = tournament?.remainingPlayers ?? activePlayers.length;
  const tournamentTotalPlayers = tournament?.registeredCount ?? gameState.players.length;
  
  // For tournaments, header POSITION should reflect chip rank (1 = most chips at the table)
  const sortedByChips = [...activePlayers].sort((a, b) => b.chips - a.chips);
  const myChipRank = myPlayer ? sortedByChips.findIndex(p => p.id === myPlayer.id) + 1 : null;
  const myPosition = myChipRank && myChipRank > 0 ? myChipRank : null;
  const myContribution = myPlayer?.contribution || 0;

  // Show landscape prompt if in portrait mode
  if (isPortrait) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-gradient-to-br from-slate-950 to-slate-900 p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="text-6xl mb-4">📱</div>
          <h2 className="text-2xl font-bold text-white">Please Rotate Your Device</h2>
          <p className="text-slate-400">
            The poker game is optimized for landscape mode. Please rotate your device to continue playing.
          </p>
        </div>
      </div>
    );
  }

  const handleCloseTable = () => {
    try {
      if (window.opener) {
        window.close();
        return;
      }
    } catch {
      // ignore
    }
    navigate('/tournaments');
  };

  return (
    <div className="flex h-[100dvh] min-h-screen w-screen flex-col bg-gradient-to-br from-slate-950 to-slate-900 overflow-hidden">
      {!socketConnected && gameState && (
        <div className="flex items-center justify-between gap-4 bg-amber-500/20 border-b border-amber-500/40 px-4 py-2 text-amber-200 text-sm shrink-0">
          <span>Connection lost. Game may be out of date.</span>
          <button type="button" onClick={() => getSocket().connect()} className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500">Reconnect</button>
        </div>
      )}
      {/* Elimination modal */}
      {eliminationInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-lg bg-slate-900 border border-slate-700 shadow-2xl max-w-sm w-full p-6 text-center">
            <h2 className="text-xl font-bold text-red-300 mb-2">You have been eliminated</h2>
            <p className="text-slate-200 mb-4">
              {eliminationInfo.place
                ? `You finished in position ${eliminationInfo.place}.`
                : 'You are out of the tournament.'}
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setEliminationInfo(null)}
                className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
              >
                Stay and Spectate
              </button>
              <button
                onClick={handleCloseTable}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Close Table
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Winner modal */}
      {winnerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-lg bg-slate-900 border border-emerald-500 shadow-2xl max-w-sm w-full p-6 text-center">
            <h2 className="text-2xl font-bold text-emerald-300 mb-2">🏆 Tournament Winner!</h2>
            <p className="text-slate-200 mb-4">
              Congratulations, you finished <span className="font-semibold">1st</span> in this tournament.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setWinnerModalOpen(false)}
                className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
              >
                Stay at Table
              </button>
              <button
                onClick={handleCloseTable}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Close Table
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Main game area - table + controls | chat (no header; info in table corners) */}
      <div className="relative z-20 flex flex-1 overflow-hidden min-h-0">
        {/* Left side - Table and controls */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Table area - takes most of the space */}
          <div className="relative flex-1 overflow-hidden bg-gradient-to-br from-slate-950 to-slate-900 min-h-0">
            {consolidationWaiting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm" style={{ zIndex: 100 }}>
                <div className="rounded-xl bg-slate-800/95 border border-slate-600 px-8 py-6 text-center max-w-md shadow-2xl">
                  <p className="text-lg font-medium text-slate-200">{consolidationWaiting}</p>
                  <p className="mt-2 text-sm text-slate-400">Please wait...</p>
                </div>
              </div>
            )}
            <PokerTable
              gameId={gameState.id}
              turnTimer={turnTimer}
              players={gameState.players.map((p: any) => ({
                id: p.id,
                name: p.name,
                chips: p.chips,
                seatNumber: p.seatNumber,
                holeCards: p.holeCards,
                isActive: p.status === 'ACTIVE',
                isDealer: p.seatNumber === gameState.dealerSeat,
                isSmallBlind: p.seatNumber === gameState.smallBlindSeat,
                isBigBlind: p.seatNumber === gameState.bigBlindSeat,
                avatarUrl: p.avatarUrl,
                userId: p.userId,
                contribution: p.contribution || 0,
                status: p.status,
              }))}
              communityCards={communityCards}
              pot={gameState.pot}
              currentBet={gameState.currentBet || 0}
              currentPlayer={gameState.currentTurnUserId}
              smallBlind={smallBlind}
              bigBlind={bigBlind}
              myUserId={user?.id}
              showdownActive={gameState.showdownActive || false}
              showdownResults={showdownResults || gameState.showdownResults}
              tournamentCountdown={tournamentCountdown}
              topLeftBlinds={`${smallBlind}/${bigBlind}`}
              topLeftTimer={nextBlindTime}
              topRightPlayers={tournament ? `${tournamentRemainingPlayers}/${tournamentTotalPlayers}` : `${activePlayers.length}/${gameState.players.length}`}
              topRightPosition={myPosition != null ? `${myPosition}${myPosition === 1 ? 'st' : myPosition === 2 ? 'nd' : myPosition === 3 ? 'rd' : 'th'}` : undefined}
            />
          </div>

          {/* Betting controls - fixed at bottom */}
          <div className="border-t border-slate-800 bg-slate-900/95 px-2 sm:px-4 py-1 sm:py-2 backdrop-blur-sm relative">
            {/* Player's own cards - bottom left, aligned with action buttons */}
            {myPlayer && myPlayer.holeCards && Array.isArray(myPlayer.holeCards) && myPlayer.holeCards.length > 0 && (
              <div className={`absolute top-4 bottom-4 left-4 z-50 flex gap-2 items-center ${myPlayer.status === 'FOLDED' ? 'opacity-50' : ''}`} style={{ visibility: 'visible' }}>
                {myPlayer.holeCards.map((card: Card, idx: number) => {
                  const getCardImage = (card: Card): string => {
                    const suitMap: Record<string, string> = {
                      "SPADES": "S", "HEARTS": "H", "DIAMONDS": "D", "CLUBS": "C"
                    };
                    const suit = suitMap[card.suit] || card.suit.charAt(0);
                    // Handle 10 specially since it's "10" not "TEN"
                    const rank = card.rank === "10" ? "10" : card.rank;
                    return `${rank}${suit}.png`;
                  };
                  return (
                    <img
                      key={idx}
                      src={`/cards/${getCardImage(card)}`}
                      alt={`${card.rank}${card.suit}`}
                      className="h-full w-auto object-contain rounded-lg shadow-lg border-2 border-white/20"
                      style={{ display: 'block' }}
                      onError={(e) => {
                        console.error('Card image failed to load:', getCardImage(card), 'Full path:', `/cards/${getCardImage(card)}`);
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                  );
                })}
              </div>
            )}
              <BettingControls 
                onAction={handleAction} 
                currentBet={gameState.currentBet || 0}
                bigBlind={bigBlind}
                myChips={myPlayer?.chips || 0}
                street={gameState.street || 'PREFLOP'}
                minimumRaise={gameState.minimumRaise || bigBlind}
                isBigBlind={myPlayer?.seatNumber === gameState.bigBlindSeat}
                isMyTurn={gameState.currentTurnUserId === user?.id}
                myContribution={myContribution}
                players={gameState.players}
                myUserId={user?.id}
              />
          </div>
        </div>

        {/* Right side - Chat (collapsible on mobile) */}
        {user && (
          <>
            {/* Chat icon tab - mobile only, when collapsed */}
            {isMobileWidth && chatCollapsed && (
              <button
                onClick={() => {
                  setChatCollapsed(false);
                  setUnreadChatCount(0);
                }}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-40 flex items-center justify-center w-10 h-14 rounded-l-lg bg-slate-800/95 border border-slate-600 border-r-0 shadow-lg"
                aria-label="Open chat"
              >
                <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {unreadChatCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                    {unreadChatCount > 99 ? '99+' : unreadChatCount}
                  </span>
                )}
              </button>
            )}
            {/* Chat panel - hidden on mobile when collapsed */}
            {(!isMobileWidth || !chatCollapsed) && (
              <div 
                className={`border-l border-slate-800 flex-shrink-0 relative ${isMobileWidth ? 'w-72 max-w-[45%]' : ''}`}
                style={!isMobileWidth ? { width: 'var(--chat-width, 320px)' } : undefined}
              >
                <div className="flex flex-col h-full">
                  {/* Header: Dealer toggle + collapse button on mobile */}
                  <div className="px-2 py-1 border-b border-slate-700 flex items-center justify-between bg-slate-800/50">
                    <span className="text-xs text-slate-300">Dealer Messages</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowDealerMessages(!showDealerMessages)}
                        className={`relative inline-flex items-center rounded-full transition-colors ${
                          showDealerMessages ? 'bg-blue-600' : 'bg-slate-600'
                        }`}
                        style={{
                          height: '20px',
                          width: '36px'
                        }}
                      >
                        <span
                          className={`inline-block rounded-full bg-white transition-transform ${
                            showDealerMessages ? 'translate-x-4' : 'translate-x-0'
                          }`}
                          style={{
                            height: '16px',
                            width: '16px',
                            marginLeft: '2px'
                          }}
                        />
                      </button>
                      {isMobileWidth && (
                        <button
                          onClick={() => setChatCollapsed(true)}
                          className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-600"
                          aria-label="Collapse chat"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0">
                    <Chat
                      gameId={gameState.id}
                      userId={user.id}
                      userName={user.username || 'Player'}
                      players={chatPlayers}
                      spectators={[]}
                      userAvatar={user.avatarUrl}
                      showPlayerListTab={false}
                      chatType="game"
                      isSpectator={false}
                      PlayerStatsModal={PlayerStatsModal}
                      showDealerMessages={showDealerMessages}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


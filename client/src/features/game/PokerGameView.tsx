import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSocket } from "../../services/socket";
import { PokerTable } from "../../components/poker/PokerTable";
import type { Card } from "@shared/types/poker";
import { BettingControls } from "../../components/poker/BettingControls";
import {
  PreActionControls,
  type PreActionKind,
} from "../../components/poker/PreActionControls";
import { useAuth } from "@shared/features/auth/AuthContext";
import Chat from "@shared/components/chat/Chat";
import type { Player } from "@shared/types/game";
import PlayerStatsModal from "../../components/modals/PlayerStatsModal";
import { api } from "../../services/api";
import { useTournament } from "../../hooks/useTournaments";
import { useIsMobile } from "../../hooks/useIsMobile";
import { TournamentLobbyModal } from "../../components/tournament/TournamentLobbyModal";
import { soundManager, type SoundName } from "../../utils/soundManager";
import { preloadCards } from "../../utils/cardPreloader";
import { getHandDescription } from "@shared/utils/handEvaluator";
import type { GameStatePayload } from "./pokerGameViewTypes";
import { handBlocksConsolidationWaitOverlay } from "./handBlocksConsolidationWaitOverlay";
import { parseCommunityCards } from "./parseCommunityCards";
import {
  getBlindScheduleForTournament,
  getBlindCountdownFromTournamentSchedule,
  type BlindLevelRow,
} from "@shared/utils/tournamentBlindSchedule";

function computePreActionForGameState(
  kind: PreActionKind,
  gs: GameStatePayload,
  userId: string
): { action: string; amount: number } | null {
  const myPlayer = gs.players.find((p) => p.userId === userId || p.id === userId);
  if (
    !myPlayer ||
    myPlayer.status === "FOLDED" ||
    myPlayer.status === "ALL_IN" ||
    (myPlayer.chips ?? 0) <= 0
  ) {
    return null;
  }

  const currentBet = gs.currentBet || 0;
  const bigBlind = gs.bigBlind || 20;
  const street = gs.street || "PREFLOP";
  const myContribution = myPlayer.contribution || 0;
  const myChips = myPlayer.chips;
  const isPreflop = street === "PREFLOP";
  const isBigBlind = myPlayer.seatNumber === gs.bigBlindSeat;
  const hasRaises = isPreflop ? currentBet > bigBlind : currentBet > 0;
  const canCheck =
    currentBet === myContribution ||
    (isPreflop && isBigBlind && currentBet === bigBlind && !hasRaises);

  if (kind === "FOLD_OR_CHECK") {
    return { action: canCheck ? "CHECK" : "FOLD", amount: 0 };
  }
  if (kind === "CALL_ANY") {
    const toCall = Math.max(0, currentBet - myContribution);
    if (toCall > myChips) return { action: "ALL_IN", amount: myChips };
    const callAmount = Math.min(toCall, myChips);
    return { action: "CALL", amount: callAmount };
  }
  if (kind === "ALL_IN") {
    return { action: "ALL_IN", amount: myChips };
  }
  return null;
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
  /** Server asks all tables to wait until hands finish before blinds go up */
  const [blindWaitMessage, setBlindWaitMessage] = useState<string | null>(null);
  /** Popups for synchronized level-up and scheduled breaks */
  const [scheduleModal, setScheduleModal] = useState<
    | {
        kind: "BREAK";
        tournamentId: string;
        breakEndsAt: string;
        message: string;
      }
    | {
        kind: "LEVEL_UP";
        tournamentId: string;
        message: string;
        smallBlind?: number | null;
        bigBlind?: number | null;
      }
    | null
  >(null);
  const [breakRemainSec, setBreakRemainSec] = useState(0);
  const [pendingConsolidationWaiting, setPendingConsolidationWaiting] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [tournamentLobbyOpen, setTournamentLobbyOpen] = useState(false);
  const isMobile = useIsMobile();
  const [chatCollapsed, setChatCollapsed] = useState(() => typeof window !== 'undefined' && (window.innerWidth <= 1024 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 'ontouchstart' in window));
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const chatCollapsedRef = useRef(chatCollapsed);
  const isMobileRef = useRef(isMobile);
  const soundUnlockedRef = useRef(false);
  const latestGameStateRef = useRef<GameStatePayload | null>(null);
  const latestGameTournamentIdRef = useRef<string | undefined>(undefined);
  const latestTournamentIdRef = useRef<string | undefined>(undefined);
  /** True after we emit player-action until the next authoritative game-state (avoids wait overlay during optimistic gap). */
  const handActionPendingRef = useRef(false);
  const prevTurnUserIdRef = useRef<string | null>(null);
  const preActionRef = useRef<PreActionKind | null>(null);
  const handleActionRef = useRef<(action: string, amount: number) => void>(() => {});
  const [preActionSelected, setPreActionSelected] = useState<PreActionKind | null>(null);
  const { user } = useAuth();
  const { tournament, refetch: refetchTournament } = useTournament(gameState?.tournamentId);

  useEffect(() => {
    latestGameStateRef.current = gameState;
    latestGameTournamentIdRef.current = gameState?.tournamentId;
    latestTournamentIdRef.current = tournament?.id;
  }, [gameState, tournament?.id]);

  // Preload card images when entering a game so they render instantly
  useEffect(() => {
    if (id) preloadCards();
  }, [id]);

  const handleSoundUnlock = () => {
    if (soundUnlockedRef.current) return;
    soundUnlockedRef.current = true;
    soundManager.unlock();
  };

  chatCollapsedRef.current = chatCollapsed;
  isMobileRef.current = isMobile;

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
      if (data.tournamentId === latestGameTournamentIdRef.current || data.tournamentId === latestTournamentIdRef.current) {
        console.log('[BLIND TIMER] Tournament started event received, refetching tournament data...');
        pollingActiveRef.current = false;
        refetchTournament();
        setTournamentCountdown(null);
        soundManager.play('tournament-start');
      }
    };

    socket.on('tournament-started', handleTournamentStarted);

    const onBlindLevelWaiting = (payload: {
      tournamentId: string;
      message: string | null;
      clear?: boolean;
    }) => {
      if (
        payload.tournamentId !== latestGameTournamentIdRef.current &&
        payload.tournamentId !== latestTournamentIdRef.current
      ) {
        return;
      }
      if (payload.clear || payload.message == null || payload.message === '') {
        setBlindWaitMessage(null);
      } else {
        setBlindWaitMessage(payload.message);
      }
    };
    socket.on('blind-level-waiting', onBlindLevelWaiting);

    const onScheduleAnnouncement = (payload: {
      tournamentId: string;
      type: "BREAK" | "LEVEL_UP";
      breakEndsAt?: string;
      message?: string;
      smallBlind?: number;
      bigBlind?: number;
    }) => {
      if (
        payload.tournamentId !== latestGameTournamentIdRef.current &&
        payload.tournamentId !== latestTournamentIdRef.current
      ) {
        return;
      }
      if (payload.type === "BREAK" && payload.breakEndsAt) {
        setScheduleModal({
          kind: "BREAK",
          tournamentId: payload.tournamentId,
          breakEndsAt: payload.breakEndsAt,
          message: payload.message || "Tournament break",
        });
      } else if (payload.type === "LEVEL_UP") {
        soundManager.play("blind-level-up");
        setScheduleModal({
          kind: "LEVEL_UP",
          tournamentId: payload.tournamentId,
          message: payload.message || "Blind level increased",
          smallBlind: payload.smallBlind,
          bigBlind: payload.bigBlind,
        });
      }
    };
    socket.on("tournament-schedule-announcement", onScheduleAnnouncement);

    const onBlindClockStarted = (payload: { tournamentId?: string }) => {
      if (
        payload.tournamentId &&
        payload.tournamentId !== latestGameTournamentIdRef.current &&
        payload.tournamentId !== latestTournamentIdRef.current
      ) {
        return;
      }
      void refetchTournament({ silent: true });
    };
    socket.on("tournament-blind-clock-started", onBlindClockStarted);

    const emitJoinTable = () => {
      socket.emit("join-table", { gameId: id });
    };

    // One join per connection: avoid double emit (mount + connect) racing startHand on the server
    const onSocketConnect = () => {
      setSocketConnected(true);
      emitJoinTable();
    };
    socket.on("connect", onSocketConnect);
    if (!socket.connected) {
      socket.connect();
    } else {
      setSocketConnected(true);
      emitJoinTable();
    }

    socket.on("game-state", (payload: GameStatePayload) => {
      // Ignore game-state for other tables (user may receive stale msgs if room leave was delayed)
      if (payload.id && id && payload.id !== id) return;

      // Start of new hand: clear any cached/stale card data so we never show previous hand's cards
      const hasWinnerPayload = (payload.showdownResults?.winners?.length ?? 0) > 0;
      const isNewHand = (payload.street === "PREFLOP" || !payload.street) && !payload.showdownActive && !hasWinnerPayload;
      const normalized: GameStatePayload = isNewHand
        ? {
            ...payload,
            communityCards: "[]",
            showdownActive: false,
            showdownResults: null,
            players: payload.players || [],
          }
        : payload;

      handActionPendingRef.current = false;
      if (
        Object.prototype.hasOwnProperty.call(payload, "consolidationWaitingMessage") &&
        !payload.consolidationWaitingMessage
      ) {
        setConsolidationWaiting(null);
        setPendingConsolidationWaiting(null);
      }

      // Never keep the blind-sync modal over an active betting round (stale socket event vs game-state).
      if (handBlocksConsolidationWaitOverlay(normalized, handActionPendingRef)) {
        setBlindWaitMessage(null);
      }

      setGameState((prev) => {
        if (prev) setPrevGameState(prev);
        return normalized;
      });
      // Clear turn timer when it's no longer this player's turn so we don't show timer after they acted
      const currentTurn = (normalized as { currentTurnUserId?: string | null }).currentTurnUserId ?? null;
      setTurnTimer((prev) => {
        if (prev == null) return prev;
        if (currentTurn === null) return null;
        if (String(prev.userId) !== String(currentTurn)) return null;
        return prev;
      });
      if (isNewHand) setShowdownResults(null);
      setConnecting(false);
      setError(null);
    });

    socket.on("error", (payload: { message: string }) => {
      setError(payload.message);
      setConnecting(false);
    });

    const onSocketDisconnect = () => {
      setSocketConnected(false);
    };
    socket.on("disconnect", onSocketDisconnect);
    setSocketConnected(socket.connected);

    socket.on("game_message", (data: { gameId: string; message: any }) => {
      // Ensure we have the correct structure
      const messageData = data.message || data;
      // Dispatch a custom event to be caught by ChatHooks
      window.dispatchEvent(new CustomEvent('gameMessage', { detail: { gameId: id, message: messageData } }));
      // If chat is collapsed on mobile and message is from another user (not dealer), increment unread
      const isUserChat = messageData && !messageData.isDealerMessage && messageData.userId !== 'DEALER' && messageData.userId !== user?.id;
      if (isUserChat && chatCollapsedRef.current && isMobileRef.current) {
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
      const matchesGameState = payload.tournamentId === latestGameTournamentIdRef.current;
      const matchesTournament = payload.tournamentId === latestTournamentIdRef.current;
      if (matchesGameState || matchesTournament) {
        const currentState = latestGameStateRef.current;
        if (handBlocksConsolidationWaitOverlay(currentState, handActionPendingRef)) {
          // Defer popup while hand is active; show it as soon as hand ends.
          setPendingConsolidationWaiting(payload.message);
        } else {
          setConsolidationWaiting(payload.message);
        }
      }
    });

    socket.on("tournament_updated", (payload?: { tournamentId?: string }) => {
      if (payload?.tournamentId) {
        const matchesGameState = payload.tournamentId === latestGameTournamentIdRef.current;
        const matchesTournament = payload.tournamentId === latestTournamentIdRef.current;
        if (!matchesGameState && !matchesTournament) return;
      }
      refetchTournament({ silent: true });
    });
    socket.on("consolidation-complete", async (payload: { tournamentId: string }) => {
      if (
        payload.tournamentId !== latestGameTournamentIdRef.current &&
        payload.tournamentId !== latestTournamentIdRef.current
      ) {
        return;
      }
      setConsolidationWaiting(null);
      setPendingConsolidationWaiting(null);
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
      const matchesGameState = payload.tournamentId === latestGameTournamentIdRef.current;
      const matchesTournament = payload.tournamentId === latestTournamentIdRef.current;

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

    // Tournament ended – refetch so winner modal and COMPLETED status show
    socket.on("tournament_completed", (payload: { tournamentId: string }) => {
      if (payload.tournamentId === latestGameTournamentIdRef.current || payload.tournamentId === latestTournamentIdRef.current) {
        refetchTournament();
      }
    });

    return () => {
      socket.off("game-state");
      socket.off("error");
      socket.off("connect", onSocketConnect);
      socket.off("disconnect", onSocketDisconnect);
      socket.off("game_message");
      socket.off("turn-timer-start");
      socket.off("showdown");
      socket.off("consolidation-waiting");
      socket.off("tournament_updated");
      socket.off("consolidation-complete");
      socket.off("winner");
      socket.off("tournament-starting");
      socket.off("tournament-started", handleTournamentStarted);
      socket.off("tournament_completed");
      socket.off("blind-level-waiting", onBlindLevelWaiting);
      socket.off("tournament-schedule-announcement", onScheduleAnnouncement);
      socket.off("tournament-blind-clock-started", onBlindClockStarted);
    };
  }, [id, user?.id, refetchTournament, navigate]);

  // Turn timer expiry display: do NOT put turnTimer in the socket effect deps (would tear down listeners).
  useEffect(() => {
    if (!turnTimer) return;
    const iv = setInterval(() => {
      setTurnTimer((prev) => {
        if (!prev) return prev;
        if (prev.expiresAt - Date.now() <= 0) return null;
        return prev;
      });
    }, 100);
    return () => clearInterval(iv);
  }, [turnTimer]);

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

  // Next blind / break countdown — anchor-based when server provides schedule fields (else legacy elapsed-time)
  useEffect(() => {
    if (!tournament) {
      setNextBlindTime("--:--");
      return;
    }

    if (!tournament.startedAt) {
      setNextBlindTime("--:--");
      return;
    }

    if (tournament.status !== "RUNNING" && tournament.status !== "ACTIVE") {
      setNextBlindTime("--:--");
      return;
    }

    const tick = () => {
      const json =
        typeof tournament.blindLevels === "string"
          ? tournament.blindLevels
          : JSON.stringify((tournament as any).blindLevels ?? []);
      const tt = tournament as any;
      const useAnchor =
        tt.awaitingHandsForBlindClock === true ||
        tt.blindPeriodAnchorAt != null ||
        tt.tournamentBreakUntilAt != null;

      if (useAnchor) {
        let blindLevels: BlindLevelRow[] = [];
        try {
          blindLevels = Array.isArray(tournament.blindLevels)
            ? tournament.blindLevels
            : JSON.parse(json || "[]");
        } catch {
          blindLevels = [];
        }
        if (!Array.isArray(blindLevels) || blindLevels.length === 0) {
          setNextBlindTime("--:--");
          return;
        }
        const levelIdx =
          typeof gameState?.currentBlindLevel === "number"
            ? gameState.currentBlindLevel
            : 0;
        const clock = getBlindCountdownFromTournamentSchedule({
          blindPeriodAnchorAt: tt.blindPeriodAnchorAt,
          awaitingHandsForBlindClock: !!tt.awaitingHandsForBlindClock,
          tournamentBreakUntilAt: tt.tournamentBreakUntilAt,
          currentLevelIndex: levelIdx,
          blindLevels,
          nowMs: Date.now(),
        });
        setNextBlindTime(clock.label);
        return;
      }

      const sched = getBlindScheduleForTournament(
        (tournament as any).startedAt,
        json,
        Date.now()
      );
      if (!sched) {
        setNextBlindTime("--:--");
        return;
      }
      if (sched.atLastLevel || sched.msUntilNextLevel == null) {
        setNextBlindTime(sched.atLastLevel ? "∞" : "--:--");
        return;
      }
      const ms = sched.msUntilNextLevel;
      if (ms <= 0) {
        setNextBlindTime("next hand");
        return;
      }
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      setNextBlindTime(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [tournament, gameState?.currentBlindLevel]);

  useEffect(() => {
    if (!scheduleModal || scheduleModal.kind !== "LEVEL_UP") return;
    const t = setTimeout(() => setScheduleModal(null), 14000);
    return () => clearTimeout(t);
  }, [scheduleModal]);

  useEffect(() => {
    if (!scheduleModal || scheduleModal.kind !== "BREAK") return;
    const end = new Date(scheduleModal.breakEndsAt).getTime();
    let iv: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    const tick = () => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setBreakRemainSec(s);
      if (s <= 0 && !closed) {
        closed = true;
        if (iv != null) clearInterval(iv);
        setScheduleModal(null);
        void refetchTournament({ silent: true });
      }
    };
    tick();
    iv = setInterval(tick, 250);
    return () => {
      if (iv != null) clearInterval(iv);
    };
  }, [scheduleModal, refetchTournament]);

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

    // 1. Turn sound: Play when it becomes my turn (string compare for id type consistency)
    const prevWasMyTurn = String(prevGameState.currentTurnUserId ?? "") === String(user.id ?? "");
    const nowIsMyTurn = String(gameState.currentTurnUserId ?? "") === String(user.id ?? "");
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

    // 5. Detect player actions using authoritative lastAction changes first.
    // Fallback to contribution/status diff when lastAction is unavailable.
    const prevPlayers = new Map(prevGameState.players.map(p => [p.id, p]));
    const mapActionToSound = (action?: string | null): SoundName | null => {
      if (!action) return null;
      const normalized = action.toUpperCase();
      if (normalized === "FOLD") return "fold";
      if (normalized === "CHECK") return "check";
      if (normalized === "CALL") return "call";
      if (normalized === "BET") return "bet";
      if (normalized === "RAISE") return "raise";
      if (normalized === "ALL_IN" || normalized === "ALLIN") return "allin";
      return null;
    };
    
    gameState.players.forEach(currentPlayer => {
      const prevPlayer = prevPlayers.get(currentPlayer.id);
      if (!prevPlayer) return;

      // Skip if this is me (don't play sounds for my own actions; string compare for id consistency)
      const isMyPlayer = String(currentPlayer.userId ?? "") === String(user.id ?? "") || String(currentPlayer.id ?? "") === String(user.id ?? "");
      const lastActionChanged = currentPlayer.lastAction && currentPlayer.lastAction !== prevPlayer.lastAction;
      if (lastActionChanged && !isMyPlayer) {
        const actionSound = mapActionToSound(currentPlayer.lastAction);
        if (actionSound) {
          soundManager.play(actionSound);
          return;
        }
      }

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
        const wasCurrentTurn = String(prevGameState.currentTurnUserId ?? "") === String(currentPlayer.userId ?? "") || String(prevGameState.currentTurnUserId ?? "") === String(currentPlayer.id ?? "");
        
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
      const wasCurrentTurn = String(prevGameState.currentTurnUserId ?? "") === String(currentPlayer.userId ?? "") || String(prevGameState.currentTurnUserId ?? "") === String(currentPlayer.id ?? "");
      const isNotCurrentTurn = String(gameState.currentTurnUserId ?? "") !== String(currentPlayer.userId ?? "") && String(gameState.currentTurnUserId ?? "") !== String(currentPlayer.id ?? "");
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

  // If consolidation-waiting arrived during an active hand, surface it immediately after hand ends.
  useEffect(() => {
    if (!pendingConsolidationWaiting) return;
    if (!handBlocksConsolidationWaitOverlay(gameState, handActionPendingRef)) {
      setConsolidationWaiting(pendingConsolidationWaiting);
      setPendingConsolidationWaiting(null);
    }
  }, [gameState, pendingConsolidationWaiting]);

  /** Optimistic update: apply local state immediately so UI feels instant; server will send authoritative game-state. */
  const applyOptimisticState = (prev: GameStatePayload, userId: string, action: string, betAmount: number): GameStatePayload => {
    const myPlayer = prev.players.find((p) => p.userId === userId || p.id === userId);
    if (!myPlayer) return prev;

    const nextPlayers = prev.players.map((p) => {
      if (p.userId !== userId && p.id !== userId) return p;
      if (action === "FOLD") return { ...p, status: "FOLDED" as const };
      const contribution = (p.contribution ?? 0) + betAmount;
      const chips = p.chips - betAmount;
      return { ...p, contribution, chips: Math.max(0, chips) };
    });
    const potIncrease = action === "FOLD" ? 0 : betAmount;
    return {
      ...prev,
      pot: prev.pot + potIncrease,
      players: nextPlayers,
      currentTurnUserId: undefined, // Clear so "your turn" disappears immediately; server sends real next turn
    };
  };

  const handleAction = (action: string, amount: number) => {
    if (!id || !gameState || !user) return;
    handActionPendingRef.current = true;
    if (action === "FOLD") soundManager.play("fold");
    else if (action === "CHECK") soundManager.play("check");
    else if (action === "CALL") soundManager.play("call");
    else if (action === "RAISE" || action === "BET" || amount > 0) soundManager.play("raise");

    const betAmount = action === "FOLD" || action === "CHECK" ? 0 : amount;
    setGameState((prev) => (prev ? applyOptimisticState(prev, user.id, action, betAmount) : prev));

    const socket = getSocket();
    socket.emit("player-action", {
      gameId: id,
      userId: user.id,
      action,
      amount
    });
  };

  handleActionRef.current = handleAction;

  useEffect(() => {
    if (!gameState?.street) return;
    preActionRef.current = null;
    setPreActionSelected(null);
  }, [gameState?.street]);

  useEffect(() => {
    if (gameState?.showdownActive) {
      preActionRef.current = null;
      setPreActionSelected(null);
    }
  }, [gameState?.showdownActive]);

  useEffect(() => {
    if (!gameState || !user?.id) return;
    const me = gameState.players.find((p) => p.userId === user.id || p.id === user.id);
    if (me?.status === "FOLDED") {
      preActionRef.current = null;
      setPreActionSelected(null);
    }
  }, [gameState, user?.id]);

  useEffect(() => {
    if (!gameState || !user?.id) return;
    const myId = String(user.id);
    const turn = String(gameState.currentTurnUserId ?? "");
    const prev = prevTurnUserIdRef.current;
    prevTurnUserIdRef.current = turn || null;

    if (turn !== myId) return;
    if (prev === myId) return;

    const kind = preActionRef.current;
    if (!kind) return;

    const cmd = computePreActionForGameState(kind, gameState, user.id);
    preActionRef.current = null;
    setPreActionSelected(null);
    if (!cmd) return;
    handleActionRef.current(cmd.action, cmd.amount);
  }, [gameState, user?.id]);

  const handleShowdownChoice = (choice: "SHOW" | "MUCK") => {
    if (!id) return;
    getSocket().emit("showdown-choice", { gameId: id, choice });
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
  const isMyTurn =
    String(gameState.currentTurnUserId ?? "") === String(user?.id ?? "");
  const canPreAction =
    !!user &&
    !isMyTurn &&
    !gameState.showdownActive &&
    !!myPlayer &&
    myPlayer.status !== "FOLDED" &&
    myPlayer.status !== "ALL_IN" &&
    (myPlayer.chips ?? 0) > 0 &&
    Array.isArray(myPlayer.holeCards) &&
    myPlayer.holeCards.length >= 2 &&
    !!gameState.currentTurnUserId;

  const effectiveConsolidationMessage =
    gameState.consolidationWaitingMessage != null &&
    String(gameState.consolidationWaitingMessage).trim().length > 0
      ? gameState.consolidationWaitingMessage
      : consolidationWaiting;
  const showConsolidationOverlay =
    !!effectiveConsolidationMessage &&
    !handBlocksConsolidationWaitOverlay(gameState, handActionPendingRef);

  const showBlindWaitOverlay =
    !!blindWaitMessage &&
    !showConsolidationOverlay &&
    !handBlocksConsolidationWaitOverlay(gameState, handActionPendingRef);

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
    <div
      className="flex h-[100dvh] min-h-screen w-screen flex-col bg-gradient-to-br from-slate-950 to-slate-900 overflow-hidden"
      onPointerDown={handleSoundUnlock}
    >
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
      <div className="relative z-20 flex min-h-0 flex-1 items-stretch overflow-hidden">
        {/* Left side - Table and controls */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Table area - takes most of the space */}
          <div className="relative flex-1 overflow-hidden bg-gradient-to-br from-slate-950 to-slate-900 min-h-0">
            {showConsolidationOverlay && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm" style={{ zIndex: 100 }}>
                <div className="rounded-xl bg-slate-800/95 border border-slate-600 px-8 py-6 text-center max-w-md shadow-2xl">
                  <p className="text-lg font-medium text-slate-200">{effectiveConsolidationMessage}</p>
                  <p className="mt-2 text-sm text-slate-400">Please wait...</p>
                </div>
              </div>
            )}
            {showBlindWaitOverlay && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm"
                style={{ zIndex: 95 }}
              >
                <div className="max-w-md rounded-xl border border-amber-500/50 bg-slate-800/95 px-8 py-6 text-center shadow-2xl">
                  <p className="text-lg font-medium text-amber-100">{blindWaitMessage}</p>
                  <p className="mt-2 text-sm text-slate-400">
                    Blinds will go up together when every table finishes the current hand.
                  </p>
                </div>
              </div>
            )}
            {/* Blind level / break: same placement + chrome as consolidation (table-centered, not full viewport) */}
            {scheduleModal && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
                style={{ zIndex: 101 }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="schedule-modal-title"
              >
                <div className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-800/95 px-8 py-6 text-center shadow-2xl">
                  {scheduleModal.kind === "BREAK" ? (
                    <>
                      <p id="schedule-modal-title" className="text-lg font-medium text-slate-200">
                        Tournament break
                      </p>
                      {scheduleModal.message ? (
                        <p className="mt-2 text-base text-slate-300">{scheduleModal.message}</p>
                      ) : null}
                      <p className="mt-4 font-mono text-4xl font-semibold tabular-nums text-white">
                        {Math.floor(breakRemainSec / 60)}:
                        {(breakRemainSec % 60).toString().padStart(2, "0")}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">No new hands until the break ends.</p>
                      <button
                        type="button"
                        className="mt-6 rounded-lg bg-slate-700 px-5 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
                        onClick={() => {
                          setScheduleModal(null);
                          void refetchTournament({ silent: true });
                        }}
                      >
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <>
                      <p id="schedule-modal-title" className="text-lg font-medium text-slate-200">
                        Blind level up
                      </p>
                      <p className="mt-2 text-lg text-slate-200">{scheduleModal.message}</p>
                      {scheduleModal.smallBlind != null && scheduleModal.bigBlind != null && (
                        <p className="mt-2 text-sm text-slate-400">
                          New blinds: {Number(scheduleModal.smallBlind).toLocaleString()} /{" "}
                          {Number(scheduleModal.bigBlind).toLocaleString()}
                        </p>
                      )}
                      <p className="mt-3 text-sm text-slate-400">
                        The blind timer restarts once every table has started the next hand.
                      </p>
                      <button
                        type="button"
                        className="mt-6 rounded-lg bg-slate-700 px-5 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
                        onClick={() => setScheduleModal(null)}
                      >
                        OK
                      </button>
                    </>
                  )}
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
                lastAction: p.lastAction || null,
                lastActionSeq: p.lastActionSeq || 0,
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
              onTournamentLobbyClick={gameState.tournamentId ? () => setTournamentLobbyOpen(true) : undefined}
              topRightPlayers={tournament ? `${tournamentRemainingPlayers}/${tournamentTotalPlayers}` : `${activePlayers.length}/${gameState.players.length}`}
              topRightPosition={myPosition != null ? `${myPosition}${myPosition === 1 ? 'st' : myPosition === 2 ? 'nd' : myPosition === 3 ? 'rd' : 'th'}` : undefined}
            />
          </div>

          {/* Betting controls - fixed height so layout does not jump when controls are hidden */}
          <div className="relative flex h-[208px] w-full shrink-0 items-stretch overflow-hidden border-t border-slate-800 bg-slate-900/95 px-2 py-1.5 backdrop-blur-sm sm:h-[216px] sm:px-4 sm:py-2">
            {/* Player's own cards + hand text - fill left side of panel height */}
            {myPlayer && myPlayer.holeCards && Array.isArray(myPlayer.holeCards) && myPlayer.holeCards.length > 0 && (
              <div className={`absolute left-2 sm:left-4 top-0 bottom-0 z-50 flex flex-col justify-center gap-1 items-start ${myPlayer.status === 'FOLDED' ? 'opacity-50' : ''}`} style={{ visibility: 'visible' }}>
                <span className="text-slate-300 text-sm sm:text-base font-medium whitespace-nowrap leading-tight">
                  {getHandDescription(myPlayer.holeCards, communityCards, gameState.street || "PREFLOP")}
                </span>
                <div className="flex gap-1.5 sm:gap-2 items-center flex-1 min-h-0">
                {myPlayer.holeCards.map((card: Card, idx: number) => {
                  const suitSymbols: Record<string, string> = { SPADES: "♠", HEARTS: "♥", DIAMONDS: "♦", CLUBS: "♣" };
                  const isRed = card.suit === "HEARTS" || card.suit === "DIAMONDS";
                  if (isMobile) {
                    const cardH = 64;
                    const cardW = Math.round(cardH * (80 / 112));
                    const rankSize = Math.max(10, Math.floor(cardH * 0.42));
                    const suitSize = Math.max(10, Math.floor(cardH * 0.38));
                    return (
                      <div
                        key={idx}
                        className="flex flex-col items-center justify-center rounded-lg border-2 border-slate-300 bg-white shadow py-1 px-0.5 flex-shrink-0"
                        style={{ width: cardW, height: cardH, minWidth: cardW, minHeight: cardH }}
                      >
                        <span className="font-bold leading-none text-slate-900" style={{ fontSize: rankSize }}>{card.rank}</span>
                        <span className="leading-none" style={{ fontSize: suitSize, color: isRed ? '#b91c1c' : '#1a1a1a' }}>{suitSymbols[card.suit] ?? card.suit[0]}</span>
                      </div>
                    );
                  }
                  const getCardImage = (card: Card): string => {
                    const suitMap: Record<string, string> = {
                      "SPADES": "S", "HEARTS": "H", "DIAMONDS": "D", "CLUBS": "C"
                    };
                    const suit = suitMap[card.suit] || card.suit.charAt(0);
                    const rank = card.rank === "10" ? "10" : card.rank;
                    return `${rank}${suit}.png`;
                  };
                  return (
                    <img
                      key={idx}
                      src={`/cards/${getCardImage(card)}`}
                      alt={`${card.rank}${card.suit}`}
                      className="h-[88px] sm:h-[100px] w-auto max-h-[90%] object-contain rounded-lg shadow border border-white/20 flex-shrink-0"
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
              </div>
            )}
              <div className="ml-auto flex h-full min-h-0 flex-col items-end justify-center gap-3">
                {gameState.showdownNeedsChoice && (
                  <div className="flex flex-col items-end gap-1">
                    <p className="text-xs font-medium text-slate-400">Show your cards?</p>
                    <div className="flex items-center gap-3" style={{ width: "calc(var(--action-button-width, 140px) * 2 + 0.75rem)" }}>
                      <button
                        type="button"
                        onClick={() => handleShowdownChoice("SHOW")}
                        className="rounded-lg bg-blue-600 font-bold text-white shadow-lg hover:bg-blue-700 transition-colors flex-1 whitespace-nowrap"
                        style={{
                          minWidth: `var(--action-button-width, 140px)`,
                          height: `var(--action-button-height, 48px)`,
                          paddingLeft: `var(--action-button-padding-x, 24px)`,
                          paddingRight: `var(--action-button-padding-x, 24px)`,
                          fontSize: `var(--action-button-text, 16px)`,
                        }}
                      >
                        SHOW
                      </button>
                      <button
                        type="button"
                        onClick={() => handleShowdownChoice("MUCK")}
                        className="rounded-lg bg-slate-600 font-bold text-white shadow-lg hover:bg-slate-500 transition-colors flex-1 whitespace-nowrap"
                        style={{
                          minWidth: `var(--action-button-width, 140px)`,
                          height: `var(--action-button-height, 48px)`,
                          paddingLeft: `var(--action-button-padding-x, 24px)`,
                          paddingRight: `var(--action-button-padding-x, 24px)`,
                          fontSize: `var(--action-button-text, 16px)`,
                        }}
                      >
                        MUCK
                      </button>
                    </div>
                  </div>
                )}
                {isMyTurn && !gameState.showdownActive && (
                  <BettingControls
                    onAction={handleAction}
                    currentBet={gameState.currentBet || 0}
                    bigBlind={bigBlind}
                    myChips={myPlayer?.chips || 0}
                    street={gameState.street || "PREFLOP"}
                    minimumRaise={gameState.minimumRaise || bigBlind}
                    isBigBlind={myPlayer?.seatNumber === gameState.bigBlindSeat}
                    isMyTurn
                    myContribution={myContribution}
                    players={gameState.players}
                    myUserId={user?.id}
                    potSize={gameState.pot}
                  />
                )}
                {canPreAction && (
                  <PreActionControls
                    selected={preActionSelected}
                    onSelect={(k) => {
                      preActionRef.current = k;
                      setPreActionSelected(k);
                    }}
                  />
                )}
              </div>
          </div>
        </div>

        {/* Right side - Chat (collapsible on mobile) */}
        {user && (
          <>
            {/* Chat icon tab - mobile only, when collapsed */}
            {isMobile && chatCollapsed && (
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
            {(!isMobile || !chatCollapsed) && (
              <div 
                className={`relative flex min-h-0 shrink-0 flex-col self-stretch overflow-hidden border-l border-slate-800 ${isMobile ? "w-72 max-w-[45%]" : ""}`}
                style={!isMobile ? { width: "var(--chat-width, 320px)" } : undefined}
              >
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                      {isMobile && (
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

      {tournamentLobbyOpen && gameState?.tournamentId && (
        <TournamentLobbyModal
          tournamentId={gameState.tournamentId}
          onClose={() => setTournamentLobbyOpen(false)}
          gameState={
            gameState
              ? {
                  smallBlind: gameState.smallBlind,
                  bigBlind: gameState.bigBlind,
                  players: gameState.players?.map((p) => ({
                    userId: p.userId,
                    chips: p.chips,
                    status: p.status,
                  })),
                }
              : null
          }
        />
      )}
    </div>
  );
}


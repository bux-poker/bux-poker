import { useEffect, useState, useRef, useMemo } from "react";
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
import { BuxBanner, BuxModal, BuxModalButton } from "../../components/ui/BuxModal";
import { soundManager, type SoundName } from "../../utils/soundManager";
import { preloadCards } from "../../utils/cardPreloader";
import { getHandDescription } from "@shared/utils/handEvaluator";
import { type GameStatePayload, showdownWinnersCount, getShowdownWinnersList } from "./pokerGameViewTypes";
import { handBlocksConsolidationWaitOverlay } from "./handBlocksConsolidationWaitOverlay";
import { parseCommunityCards } from "./parseCommunityCards";
import {
  getBlindScheduleForTournament,
  getBlindCountdownFromTournamentSchedule,
  type BlindLevelRow,
} from "@shared/utils/tournamentBlindSchedule";
import {
  getMyTournamentStanding,
  ordinalSuffix,
} from "../../utils/tournamentStanding";
import { useTableReactions } from "../../hooks/useTableReactions";

/** Do not render 0-chip seats on the felt (all-in is the exception; viewer kept for bust UX). */
function includePlayerOnTableUI(
  p: { chips?: number; status?: string; userId?: string; id?: string },
  myUserId: string | undefined
): boolean {
  if (p.status === "ELIMINATED") return false;
  const chips = p.chips ?? 0;
  if (chips > 0) return true;
  if (p.status === "ALL_IN") return true;
  if (
    myUserId &&
    (String(p.userId) === String(myUserId) || String(p.id) === String(myUserId))
  ) {
    return true;
  }
  return false;
}

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
  /** Previous game-state snapshot for sound logic (must not use setState inside setState). */
  const prevGameStateRef = useRef<GameStatePayload | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [turnTimer, setTurnTimer] = useState<{ userId: string; expiresAt: number; duration: number } | null>(null);
  const [timerTick, setTimerTick] = useState(0);
  const timerExpiryKeyRef = useRef<string | null>(null);
  const [nextBlindTime, setNextBlindTime] = useState<string>('--:--');
  const [isPortrait, setIsPortrait] = useState(false);
  const [showdownResults, setShowdownResults] = useState<any>(null);
  const [showDealerMessages, setShowDealerMessages] = useState(true);
  const [tournamentCountdown, setTournamentCountdown] = useState<{ startTime: string; seconds: number } | null>(null);
  const [eliminationInfo, setEliminationInfo] = useState<{ place: number | null } | null>(null);
  const [eliminationModalDismissed, setEliminationModalDismissed] = useState(false);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);
  const [winnerModalDismissed, setWinnerModalDismissed] = useState(false);
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
  // Chat is a drawer on all viewports so the felt keeps full width.
  const [chatCollapsed, setChatCollapsed] = useState(true);
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
  /** Only clear pre-action when transitioning into FOLDED (not every socket tick). */
  const wasFoldedRef = useRef(false);
  const handleActionRef = useRef<(action: string, amount: number) => void>(() => {});
  const lastActionSoundSeqRef = useRef<Map<string, number>>(new Map());
  const [preActionSelected, setPreActionSelected] = useState<PreActionKind | null>(null);
  const { user } = useAuth();
  const { reactions, sendReaction, cooldownRemainingMs } = useTableReactions(
    id,
    user?.id
  );
  /** Keeps GET /api/tournaments/:id loading when game-state drops tournamentId but consolidation sockets still name the MTT. */
  const [socketTournamentIdHint, setSocketTournamentIdHint] = useState<string | null>(null);  const effectiveTournamentId = gameState?.tournamentId ?? socketTournamentIdHint ?? undefined;
  const { tournament, refetch: refetchTournament } = useTournament(effectiveTournamentId);

  /** Stable across refetches when seat rows are unchanged (avoids effect churn on new `players` array refs). */
  const tournamentPlayersSeatSig = useMemo(() => {
    if (!tournament?.players?.length) return "";
    return tournament.players
      .map(
        (p: { userId?: string; gameId?: string; status?: string }) =>
          `${String(p.userId ?? "")}:${String(p.gameId ?? "")}:${String(p.status ?? "")}`
      )
      .sort()
      .join("|");
  }, [tournament?.players]);

  const myTournamentPlayerSig = useMemo(() => {
    if (!tournament?.players?.length || !user?.id) return "";
    const me = tournament.players.find((p: { userId?: string }) => String(p.userId) === String(user.id));
    if (!me) return "";
    const m = me as { status?: string; finishingPlace?: number; position?: number };
    return `${m.status ?? ""}:${m.finishingPlace ?? ""}:${m.position ?? ""}`;
  }, [tournament?.players, user?.id]);

  /** Stable reference for table; parseCommunityCards() alone allocates a new [] every call. */
  const communityCards = useMemo((): Card[] => {
    if (!gameState?.communityCards) return [];
    return parseCommunityCards(gameState.communityCards);
  }, [gameState?.communityCards]);

  useEffect(() => {
    latestGameStateRef.current = gameState;
    latestGameTournamentIdRef.current = gameState?.tournamentId;
    latestTournamentIdRef.current = tournament?.id;
  }, [gameState, tournament?.id]);

  /** Latest tournament + gameState for blind clock tick (avoids effect deps on whole `tournament` object). */
  const nextBlindClockRef = useRef<{
    tournament: typeof tournament;
    gameState: GameStatePayload | null;
  }>({ tournament: null, gameState: null });
  nextBlindClockRef.current = { tournament, gameState };

  const tournamentRef = useRef(tournament);
  tournamentRef.current = tournament;

  useEffect(() => {
    setSocketTournamentIdHint(null);
  }, [id]);

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
    if (!effectiveTournamentId || !tournament) return;
    const interval = setInterval(() => refetchTournament({ silent: true }), 10000);
    return () => clearInterval(interval);
  }, [effectiveTournamentId, tournament?.id, refetchTournament]);

  const wrongTableByTournamentPayload = useMemo(() => {
    if (!user?.id || !id || !tournament?.players?.length) return false;
    const me = tournament.players.find(
      (p: { userId?: string; gameId?: string; status?: string }) =>
        String(p.userId) === String(user.id)
    );
    if (!me || me.status === "ELIMINATED") return false;
    const gid = (me as { gameId?: string }).gameId;
    return !!(gid && String(gid) !== String(id));
  }, [tournamentPlayersSeatSig, user?.id, id, tournament?.players]);

  /** Always resolve active seat from DB while seated in a live tournament table (reseats, etc.). */
  useEffect(() => {
    const tid = effectiveTournamentId;
    if (!tid || !user?.id || !id) return;
    // Don't yank eliminated players around.
    if (wrongTableByTournamentPayload === false) {
      const me = tournament?.players?.find(
        (p: { userId?: string; status?: string }) => String(p.userId) === String(user.id)
      );
      if (me?.status === "ELIMINATED") return;
    }

    let cancelled = false;
    const tick = async () => {
      try {
        const sessionToken =
          typeof localStorage !== "undefined" ? localStorage.getItem("sessionToken") : null;
        const res = await api.get<{ gameId?: string }>(`/api/tournaments/${tid}/my-table`, {
          headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined,
        });
        const gid = res.data?.gameId;
        if (cancelled || !gid) return;
        if (String(gid) !== String(id)) {
          setConsolidationWaiting(null);
          setPendingConsolidationWaiting(null);
          navigate(`/game/${gid}`, { replace: true });
        }
      } catch {
        /* 404 / network — retry on next tick */
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [effectiveTournamentId, user?.id, id, navigate, tournament?.players, wrongTableByTournamentPayload]);

  /** If DB says we're seated on another game (reseated), leave stale /game/:id + wait overlay. */
  useEffect(() => {
    const t = tournamentRef.current;
    if (!user?.id || !id || !t?.id || !t?.players?.length) return;
    const me = t.players.find(
      (p: { userId?: string; status?: string; gameId?: string }) =>
        String(p.userId) === String(user.id)
    );
    if (!me || me.status === "ELIMINATED") return;
    const correctGameId = (me as { gameId?: string }).gameId;
    if (!correctGameId || String(correctGameId) === String(id)) return;
    setConsolidationWaiting(null);
    setPendingConsolidationWaiting(null);
    navigate(`/game/${correctGameId}`, { replace: true });
  }, [tournamentPlayersSeatSig, user?.id, id, tournament?.id, navigate]);
  const lastTournamentStatusRef = useRef<string | null>(null);
  const lastPlayerStatusRef = useRef<string | null>(null);

  /** Browsers only allow fullscreen from a user gesture — no auto-request on load. */
  const [showFullscreenButton, setShowFullscreenButton] = useState(false);
  useEffect(() => {
    const sync = () => {
      setShowFullscreenButton(
        typeof window !== "undefined" &&
          window.opener !== null &&
          !document.fullscreenElement
      );
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const requestFullscreenFromClick = () => {
    const el = document.documentElement;
    const p =
      el.requestFullscreen?.bind(el) ??
      (el as unknown as { webkitRequestFullscreen?: () => Promise<void> })
        .webkitRequestFullscreen?.bind(el) ??
      (el as unknown as { mozRequestFullScreen?: () => Promise<void> })
        .mozRequestFullScreen?.bind(el) ??
      (el as unknown as { msRequestFullscreen?: () => Promise<void> })
        .msRequestFullscreen?.bind(el);
    if (!p) return;
    void p().catch(() => {
      /* denied or unsupported */
    });
  };

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
    if (effectiveTournamentId) {
      refetchTournament();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTournamentId]); // refetchTournament is stable (memoized), so we can omit it
  
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
        
        refetchTournament({ silent: true }).then(() => {
          // After refetch, the tournament object will be updated and this useEffect will re-run
          // If tournament.startedAt is now set, the interval will be cleared
        }).catch((err) => {
          // Silently ignore refetch errors (they're expected during normal operation)
          if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED' && err.message !== 'Request aborted') {
            console.error('[tournament] poll refetch error:', err);
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

  /** Re-join with userId when auth loads after socket (needed for per-viewer showdown / game-state). */
  useEffect(() => {
    if (!id || !user?.id) return;
    const socket = getSocket();
    if (!socket.connected) return;
    socket.emit("join-table", { gameId: id, userId: user.id });
  }, [id, user?.id]);

  useEffect(() => {
    if (!id) return;

    const socket = getSocket();
    
    // Listen for tournament-started socket event to refetch immediately
    const handleTournamentStarted = (data: { tournamentId: string; startedAt: string }) => {
      if (data.tournamentId === latestGameTournamentIdRef.current || data.tournamentId === latestTournamentIdRef.current) {
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
        setBlindWaitMessage(null);
        socket.emit("join-table", { gameId: id, userId: user?.id });
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
      setBlindWaitMessage(null);
      // Re-join room so we don't miss the next game-state after a level transition.
      socket.emit("join-table", { gameId: id, userId: user?.id });
      void refetchTournament({ silent: true });
    };
    socket.on("tournament-blind-clock-started", onBlindClockStarted);

    const emitJoinTable = () => {
      socket.emit("join-table", { gameId: id, userId: user?.id });
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
      const hasWinnerPayload = showdownWinnersCount(payload.showdownResults) > 0;
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
      {
        const cw = payload.consolidationWaitingMessage;
        if (cw == null || String(cw).trim() === "") {
          setConsolidationWaiting(null);
          setPendingConsolidationWaiting(null);
        }
      }

      // Never keep the blind-sync modal over an active betting round (stale socket event vs game-state).
      if (handBlocksConsolidationWaitOverlay(normalized, handActionPendingRef)) {
        setBlindWaitMessage(null);
      }

      setGameState(normalized);
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
      // If chat drawer is closed and message is from another user (not dealer), increment unread
      const isUserChat = messageData && !messageData.isDealerMessage && messageData.userId !== 'DEALER' && messageData.userId !== user?.id;
      if (isUserChat && chatCollapsedRef.current) {
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
        const winners = getShowdownWinnersList(payload.results);
        const realShowdown = winners.some(
          (w) => typeof w.handCategory === "string" && w.handCategory.length > 0
        );
        if (realShowdown) {
          soundManager.playQueued("showdown");
        }
        setTimeout(() => setShowdownResults(null), 8000);
      }
    });

    socket.on("consolidation-waiting", (payload: { message: string; tournamentId: string }) => {
      const matchesGameState = payload.tournamentId === latestGameTournamentIdRef.current;
      const matchesTournament = payload.tournamentId === latestTournamentIdRef.current;
      if (matchesGameState || matchesTournament) {
        setSocketTournamentIdHint(payload.tournamentId);
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
      // Do NOT add extra HTTP/API work here — this fires very often (blinds, actions, etc.) and was hammering the DB.
      refetchTournament({ silent: true });
    });
    socket.on("consolidation-complete", async (payload: { tournamentId: string }) => {
      const tid = payload?.tournamentId;
      if (!tid || !user?.id || !id) return;
      setSocketTournamentIdHint(tid);
      setConsolidationWaiting(null);
      setPendingConsolidationWaiting(null);
      setTimeout(() => void refetchTournament({ silent: true }), 0);
      // Prefer authoritative my-table over tournament.players payload (can lag after reseat).
      let sawNotPlaying = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const sessionToken =
            typeof localStorage !== "undefined" ? localStorage.getItem("sessionToken") : null;
          const res = await api.get<{ gameId?: string }>(`/api/tournaments/${tid}/my-table`, {
            headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined,
          });
          const gid = res.data?.gameId;
          if (gid && String(gid) !== String(id)) {
            navigate(`/game/${gid}`, { replace: true });
            return;
          }
          if (gid && String(gid) === String(id)) return;
        } catch (err: any) {
          if (err?.response?.status === 404) sawNotPlaying = true;
        }
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
      // Eliminated players get 404 from my-table — stop reseat wait and show exit UI.
      if (sawNotPlaying) {
        setConsolidationWaiting(null);
        setPendingConsolidationWaiting(null);
        setEliminationInfo((prev) => prev ?? { place: null });
        setEliminationModalDismissed(false);
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

  // Do NOT clear turnTimer when expiresAt passes — keep showing 0 until game-state updates.
  useEffect(() => {
    if (!turnTimer) return;
    const id = setInterval(() => setTimerTick((t) => t + 1), 150);
    return () => clearInterval(id);
  }, [turnTimer?.userId, turnTimer?.expiresAt]);

  // When the visible countdown hits 0, apply CHECK/FOLD immediately in the UI (don't wait on server lag).
  useEffect(() => {
    if (!turnTimer || !gameState) return;
    if (Date.now() < turnTimer.expiresAt) return;

    const key = `${turnTimer.userId}:${turnTimer.expiresAt}`;
    if (timerExpiryKeyRef.current === key) return;
    timerExpiryKeyRef.current = key;

    const actor = gameState.players.find(
      (p) =>
        String(p.userId) === String(turnTimer.userId) ||
        String(p.id) === String(turnTimer.userId)
    );
    if (
      !actor ||
      actor.status === "FOLDED" ||
      actor.status === "ALL_IN" ||
      actor.isAway
    ) {
      return;
    }
    if (actor.name?.toLowerCase().startsWith("test player")) return;

    const currentBet = gameState.currentBet || 0;
    const contrib = actor.contribution || 0;
    const action = contrib >= currentBet ? "CHECK" : "FOLD";
    const isMe = String(user?.id) === String(turnTimer.userId);

    if (isMe) {
      handleActionRef.current?.(action, 0, { timedOut: true });
      return;
    }

    handActionPendingRef.current = true;
    setGameState((prev) => {
      if (!prev) return prev;
      const uid = turnTimer.userId;
      return {
        ...prev,
        players: prev.players.map((p) => {
          if (String(p.userId) !== String(uid) && String(p.id) !== String(uid)) {
            return p;
          }
          if (action === "FOLD") {
            return { ...p, status: "FOLDED", isAway: true };
          }
          return { ...p, isAway: true };
        }),
        currentTurnUserId: undefined,
      };
    });
  }, [turnTimer, gameState, timerTick, user?.id]);

  useEffect(() => {
    if (turnTimer && Date.now() < turnTimer.expiresAt) {
      timerExpiryKeyRef.current = null;
    }
  }, [turnTimer?.userId, turnTimer?.expiresAt]);

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
        setTournamentCountdown((prev) => {
          if (!prev) return null;
          if (prev.seconds === remaining) return prev;
          return { ...prev, seconds: remaining };
        });
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

  // Next blind / break countdown — anchor-based when server provides schedule fields (else legacy elapsed-time).
  // Do not depend on `tournament` identity (refetch creates a new object every time → effect storm + update depth).
  useEffect(() => {
    const tick = () => {
      const { tournament, gameState } = nextBlindClockRef.current;
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
        const rawIdx =
          typeof gameState?.currentBlindLevel === "number"
            ? gameState.currentBlindLevel
            : typeof tt.canonicalBlindLevelIndex === "number"
              ? tt.canonicalBlindLevelIndex
              : 0;
        const levelIdx = Math.min(
          Math.max(0, rawIdx),
          Math.max(0, blindLevels.length - 1)
        );
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
  }, []);

  useEffect(() => {
    if (!scheduleModal || scheduleModal.kind !== "LEVEL_UP") return;
    const t = setTimeout(() => setScheduleModal(null), 2000);
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
    const tournament = tournamentRef.current;
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

    // Show elimination modal when the player becomes (or is discovered) ELIMINATED.
    if (currentStatus === 'ELIMINATED' && prevStatus !== 'ELIMINATED') {
      const place: number | null = typeof me?.finishingPlace === 'number'
        ? me.finishingPlace
        : (typeof me?.position === 'number' ? me.position : null);
      setEliminationInfo({ place });
      setEliminationModalDismissed(false);
      setConsolidationWaiting(null);
      setPendingConsolidationWaiting(null);
    }

    // Show winner modal when tournament is completed and this player finished 1st
    const finishedFirst =
      (tournament.status === 'COMPLETED') &&
      me &&
      (me.finishingPlace === 1 || me.position === 1);

    if (finishedFirst && !winnerModalOpen && !winnerModalDismissed) {
      setWinnerModalOpen(true);
      setConsolidationWaiting(null);
      setPendingConsolidationWaiting(null);
    }
  }, [myTournamentPlayerSig, tournament?.status, tournament?.id, user, winnerModalOpen, winnerModalDismissed]);

  // Sound effects: Play sounds when game state changes
  useEffect(() => {
    if (!gameState || !user) return;
    const prevGameState = prevGameStateRef.current;
    if (!prevGameState) {
      prevGameStateRef.current = gameState;
      return;
    }

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
        soundManager.playQueued('deal-flop');
      } else if (currentStreet === 'TURN') {
        soundManager.playQueued('deal-turn');
      } else if (currentStreet === 'RIVER') {
        soundManager.playQueued('deal-river');
      }
    }

    // 3. Showdown — only real multi-way showdowns (fold wins have no handCategory)
    const prevShowdown = prevGameState.showdownActive || false;
    const currentShowdown = gameState.showdownActive || false;
    if (!prevShowdown && currentShowdown) {
      const winners = getShowdownWinnersList(gameState.showdownResults);
      const realShowdown =
        gameState.showdownForcedReveal ||
        winners.some((w) => typeof w.handCategory === "string" && w.handCategory.length > 0);
      if (realShowdown) {
        soundManager.playQueued("showdown");
      }
    }

    // 4. New hand start (detected by street resetting to PREFLOP and pot resetting)
    const prevPot = prevGameState.pot || 0;
    const currentPot = gameState.pot || 0;
    if (prevPot > 0 && currentPot === 0 && currentStreet === 'PREFLOP' && prevStreet !== 'PREFLOP') {
      soundManager.playQueued('hand-start');
      lastActionSoundSeqRef.current.clear();
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
      const seq = currentPlayer.lastActionSeq ?? 0;
      const prevSeq = prevPlayer.lastActionSeq ?? 0;
      const actionSeqChanged = seq > 0 && seq !== prevSeq;
      const lastActionChanged = currentPlayer.lastAction && currentPlayer.lastAction !== prevPlayer.lastAction;
      const actionChanged = actionSeqChanged || lastActionChanged;

      if (actionChanged && !isMyPlayer) {
        if (actionSeqChanged) {
          const lastPlayed = lastActionSoundSeqRef.current.get(currentPlayer.id) ?? 0;
          if (seq <= lastPlayed) return;
          lastActionSoundSeqRef.current.set(currentPlayer.id, seq);
        }
        const actionSound = mapActionToSound(currentPlayer.lastAction);
        if (actionSound) {
          soundManager.playQueued(actionSound);
          return;
        }
      }

      // Fold sound: Player status changed to FOLDED
      if (prevPlayer.status !== 'FOLDED' && currentPlayer.status === 'FOLDED') {
        if (!isMyPlayer) {
          soundManager.playQueued('fold');
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
        soundManager.playQueued('allin');
        return;
      }

      // Bet/Call/Raise detection — only when lastActionSeq did not already play the sound
      if (contributionIncreased && currentPlayer.status === 'ACTIVE' && !isMyPlayer && !actionSeqChanged) {
        const prevBet = prevGameState.currentBet || 0;
        const currentBet = gameState.currentBet || 0;
        const wasCurrentTurn = String(prevGameState.currentTurnUserId ?? "") === String(currentPlayer.userId ?? "") || String(prevGameState.currentTurnUserId ?? "") === String(currentPlayer.id ?? "");
        
        // Raise: Bet increased and this player was the one who raised
        if (currentBet > prevBet && wasCurrentTurn) {
          soundManager.playQueued('raise');
        }
        // Call: Bet exists and player matched it
        else if (currentBet > 0 && currentContribution === currentBet) {
          soundManager.playQueued('call');
        }
        // Bet: New bet placed (no previous bet)
        else if (prevBet === 0 && currentBet > 0) {
          soundManager.playQueued('bet');
        }
        // Default to call if we can't determine
        else {
          soundManager.playQueued('call');
        }
        return;
      }

      // Check sound: Player was the current turn, now they're not, contribution didn't change, and currentBet is 0
      const wasCurrentTurn = String(prevGameState.currentTurnUserId ?? "") === String(currentPlayer.userId ?? "") || String(prevGameState.currentTurnUserId ?? "") === String(currentPlayer.id ?? "");
      const isNotCurrentTurn = String(gameState.currentTurnUserId ?? "") !== String(currentPlayer.userId ?? "") && String(gameState.currentTurnUserId ?? "") !== String(currentPlayer.id ?? "");
      const contributionUnchanged = currentContribution === prevContribution;
      const noCurrentBet = (gameState.currentBet || 0) === 0;
      
      if (wasCurrentTurn && isNotCurrentTurn && contributionUnchanged && noCurrentBet && currentPlayer.status === 'ACTIVE' && !isMyPlayer && !actionSeqChanged) {
        soundManager.playQueued('check');
      }
    });

    // 6. Pot win detection (showdown results)
    const prevShowdownResults = prevGameState.showdownResults;
    const currentShowdownResults = gameState.showdownResults;
    if (!prevShowdownResults && currentShowdownResults) {
      const winners = getShowdownWinnersList(currentShowdownResults);
      const myPlayerWon = winners.some((w: any) => w.userId === user.id || w.playerId === user.id);
      if (myPlayerWon) {
        soundManager.play('pot-win');
      }
    }

    prevGameStateRef.current = gameState;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, user]);

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

  const handleAction = (
    action: string,
    amount: number,
    options?: { timedOut?: boolean }
  ) => {
    if (!id || !gameState || !user) return;
    handActionPendingRef.current = true;
    if (action === "FOLD") soundManager.play("fold");
    else if (action === "CHECK") soundManager.play("check");
    else if (action === "CALL") soundManager.play("call");
    else if (action === "RAISE" || action === "BET" || amount > 0) soundManager.play("raise");

    const betAmount = action === "FOLD" || action === "CHECK" ? 0 : amount;
    setGameState((prev) => {
      if (!prev) return prev;
      let next = applyOptimisticState(prev, user.id, action, betAmount);
      if (options?.timedOut) {
        next = {
          ...next,
          players: next.players.map((p) =>
            p.userId === user.id || p.id === user.id
              ? {
                  ...p,
                  isAway: true,
                  ...(action === "FOLD" ? { status: "FOLDED" as const } : {}),
                }
              : p
          ),
        };
      }
      return next;
    });

    const socket = getSocket();
    socket.emit("player-action", {
      gameId: id,
      userId: user.id,
      action,
      amount,
      timedOut: options?.timedOut ?? false,
    });
  };

  const handleImBack = () => {
    if (!id || !user?.id) return;
    getSocket().emit("player-im-back", { gameId: id, userId: user.id });
    setGameState((prev) =>
      prev
        ? {
            ...prev,
            players: prev.players.map((p) =>
              p.userId === user.id || p.id === user.id
                ? { ...p, isAway: false }
                : p
            ),
          }
        : prev
    );
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
    const folded = me?.status === "FOLDED";
    if (folded && !wasFoldedRef.current) {
      preActionRef.current = null;
      setPreActionSelected(null);
    }
    wasFoldedRef.current = !!folded;
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
    if (!id || !user?.id) return;
    setGameState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        showdownNeedsChoice: false,
        players: prev.players.map((p) => {
          const mine =
            String(p.userId ?? "") === String(user.id) ||
            String(p.id ?? "") === String(user.id);
          if (!mine) return p;
          return {
            ...p,
            showdownRevealStatus: choice,
            holeCards: choice === "MUCK" ? undefined : p.holeCards,
          };
        }),
      };
    });
    getSocket().emit("showdown-choice", { gameId: id, choice, userId: user.id });
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
  
  // Cash / no tournament payload: chip rank among players at this table only
  const sortedByChips = [...activePlayers].sort((a, b) => b.chips - a.chips);
  const myTableChipRank = myPlayer
    ? sortedByChips.findIndex((p) => p.id === myPlayer.id) + 1
    : null;

  const tournamentStanding = getMyTournamentStanding(
    tournament,
    gameState,
    user?.id
  );
  const myPositionStr =
    gameState.tournamentId
      ? tournamentStanding.place != null && tournamentStanding.total > 0
        ? `${ordinalSuffix(tournamentStanding.place)}`
        : myTableChipRank && myTableChipRank > 0
          ? ordinalSuffix(myTableChipRank)
          : null
      : myTableChipRank && myTableChipRank > 0
        ? ordinalSuffix(myTableChipRank)
        : null;
  const myContribution = myPlayer?.contribution || 0;
  const isMyTurn =
    String(gameState.currentTurnUserId ?? "") === String(user?.id ?? "") &&
    !myPlayer?.isAway;
  const canPreAction =
    !!user &&
    !isMyTurn &&
    !gameState.showdownActive &&
    !!myPlayer &&
    !myPlayer.isAway &&
    myPlayer.status !== "FOLDED" &&
    myPlayer.status !== "ALL_IN" &&
    (myPlayer.chips ?? 0) > 0 &&
    Array.isArray(myPlayer.holeCards) &&
    myPlayer.holeCards.length >= 2 &&
    !!gameState.currentTurnUserId;

  const tournamentMe = tournament?.players?.find(
    (p: { userId?: string }) => String(p.userId) === String(user?.id)
  ) as { status?: string; finishingPlace?: number; position?: number } | undefined;
  const isEliminatedViewer =
    tournamentMe?.status === "ELIMINATED" ||
    myPlayer?.status === "ELIMINATED" ||
    !!eliminationInfo;
  const isTournamentWinner =
    tournament?.status === "COMPLETED" &&
    !!tournamentMe &&
    (tournamentMe.finishingPlace === 1 || tournamentMe.position === 1);
  const showPersistentExitControls =
    (isEliminatedViewer && (eliminationModalDismissed || !eliminationInfo)) ||
    (isTournamentWinner && (winnerModalDismissed || !winnerModalOpen));

  const effectiveConsolidationMessage =
    gameState.consolidationWaitingMessage != null &&
    String(gameState.consolidationWaitingMessage).trim().length > 0
      ? gameState.consolidationWaitingMessage
      : consolidationWaiting;
  const handResolvedForReseat =
    (gameState.showdownResults?.winners?.length ?? 0) > 0 &&
    !gameState.showdownActive;
  // Eliminated / finished players are not being reseated — never trap them under the wait overlay.
  const showConsolidationOverlay =
    !!effectiveConsolidationMessage &&
    !isEliminatedViewer &&
    !isTournamentWinner &&
    tournament?.status !== "COMPLETED" &&
    !handBlocksConsolidationWaitOverlay(gameState, handActionPendingRef) &&
    !handResolvedForReseat;

  const showBlindWaitOverlay =
    !!blindWaitMessage &&
    !showConsolidationOverlay &&
    !handBlocksConsolidationWaitOverlay(gameState, handActionPendingRef);

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
      className="flex h-[100dvh] min-h-screen w-screen flex-col overflow-hidden"
      style={{ background: "var(--bux-ink, #0b0f14)" }}
      onPointerDown={handleSoundUnlock}
    >
      {isPortrait && (
        <div className="bux-banner z-[80] shrink-0 border-b border-bux-brass/30 bg-bux-panel/95 px-4 py-2 text-center text-sm text-bux-brass">
          Landscape works best — rotate for a fuller table view.
        </div>
      )}
      {showFullscreenButton && isMobile && (
        <div className="flex shrink-0 justify-end border-b border-bux-brass/20 bg-bux-panel/80 px-3 py-1.5">
          <button
            type="button"
            onClick={requestFullscreenFromClick}
            className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-600"
          >
            Fullscreen
          </button>
        </div>
      )}
      {!socketConnected && gameState && (
        <div className="shrink-0 px-3 pt-3">
          <BuxBanner
            title="Connection lost"
            icon="wifi"
            tone="warning"
            action={
              <BuxModalButton variant="primary" onClick={() => getSocket().connect()}>
                Reconnect
              </BuxModalButton>
            }
          >
            Game may be out of date until you reconnect.
          </BuxBanner>
        </div>
      )}
      {/* Main game area - table + controls | chat (no header; info in table corners) */}
      <div className="relative z-20 flex min-h-0 flex-1 items-stretch overflow-hidden">
        {/* Left side - Table and controls (modals contained here so chat stays clear) */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Elimination modal — centered on table column */}
          {eliminationInfo && !eliminationModalDismissed && (
            <BuxModal
              title="You have been eliminated"
              icon="eliminated"
              tone="danger"
              onClose={() => setEliminationModalDismissed(true)}
              footer={
                <>
                  <BuxModalButton onClick={() => setEliminationModalDismissed(true)}>
                    Stay and Spectate
                  </BuxModalButton>
                  <BuxModalButton variant="primary" onClick={handleCloseTable}>
                    Close Table
                  </BuxModalButton>
                </>
              }
            >
              <p>
                {eliminationInfo.place
                  ? `You finished in position ${eliminationInfo.place}.`
                  : "You are out of the tournament."}
              </p>
            </BuxModal>
          )}

          {/* Winner modal — centered on table column */}
          {winnerModalOpen && !winnerModalDismissed && (
            <BuxModal
              title="Tournament Winner!"
              icon="trophy"
              tone="success"
              onClose={() => {
                setWinnerModalDismissed(true);
                setWinnerModalOpen(false);
              }}
              footer={
                <>
                  <BuxModalButton
                    onClick={() => {
                      setWinnerModalDismissed(true);
                      setWinnerModalOpen(false);
                    }}
                  >
                    Stay at Table
                  </BuxModalButton>
                  <BuxModalButton variant="primary" onClick={handleCloseTable}>
                    Close Table
                  </BuxModalButton>
                </>
              }
            >
              <p>
                Congratulations, you finished <span className="font-semibold">1st</span> in this
                tournament.
              </p>
            </BuxModal>
          )}

          {showPersistentExitControls && (
            <div className="absolute bottom-4 left-1/2 z-[110] -translate-x-1/2">
              <BuxModalButton variant="primary" onClick={handleCloseTable}>
                Close Table
              </BuxModalButton>
            </div>
          )}

          {tournamentLobbyOpen && gameState?.tournamentId && (
            <TournamentLobbyModal
              tournamentId={gameState.tournamentId}
              onClose={() => setTournamentLobbyOpen(false)}
              containToParent
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

          {/* Table area - takes most of the space */}
          <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: "var(--bux-ink, #0b0f14)" }}>
            {(showConsolidationOverlay ||
              (!showConsolidationOverlay &&
                handResolvedForReseat &&
                !!effectiveConsolidationMessage)) && (
              <div className="absolute left-1/2 top-3 z-[100] w-full max-w-lg -translate-x-1/2 px-4">
                <BuxBanner title="Tables consolidating" icon="wait">
                  {effectiveConsolidationMessage} Please wait…
                </BuxBanner>
              </div>
            )}
            {showBlindWaitOverlay && (
              <div className="absolute left-1/2 top-3 z-[95] w-full max-w-lg -translate-x-1/2 px-4">
                <BuxBanner title="Syncing blind level" icon="blinds" tone="warning">
                  {blindWaitMessage}
                  <span className="mt-1 block">
                    Blinds rise together when every table finishes the current hand.
                  </span>
                </BuxBanner>
              </div>
            )}
            {scheduleModal?.kind === "BREAK" && (
              <BuxModal
                title="Tournament break"
                icon="break"
                maxWidth="md"
                zIndexClass="z-[101]"
                onClose={() => {
                  setScheduleModal(null);
                  void refetchTournament({ silent: true });
                }}
                footer={
                  <BuxModalButton
                    onClick={() => {
                      setScheduleModal(null);
                      void refetchTournament({ silent: true });
                    }}
                  >
                    Dismiss
                  </BuxModalButton>
                }
              >
                {scheduleModal.message ? (
                  <p className="text-slate-300">{scheduleModal.message}</p>
                ) : null}
                <p className="mt-4 font-mono text-4xl font-semibold tabular-nums text-white">
                  {Math.floor(breakRemainSec / 60)}:
                  {(breakRemainSec % 60).toString().padStart(2, "0")}
                </p>
                <p className="mt-2 text-sm text-slate-400">No new hands until the break ends.</p>
              </BuxModal>
            )}
            {scheduleModal?.kind === "LEVEL_UP" && (
              <BuxModal
                title="Blind level up"
                icon="blinds"
                tone="warning"
                maxWidth="md"
                zIndexClass="z-[101]"
                onClose={() => setScheduleModal(null)}
                footer={<BuxModalButton onClick={() => setScheduleModal(null)}>OK</BuxModalButton>}
              >
                <p>{scheduleModal.message || "Blinds have increased."}</p>
                <p className="mt-2 text-sm text-slate-400">
                  The blind timer restarts once every table has started the next hand.
                </p>
              </BuxModal>
            )}
            <PokerTable
              gameId={gameState.id}
              turnTimer={turnTimer}
              players={gameState.players
                .filter((p: any) => includePlayerOnTableUI(p, user?.id))
                .map((p: any) => ({
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
                showdownRevealStatus: p.showdownRevealStatus || null,
                isAway: !!p.isAway,
              }))}
              communityCards={communityCards}
              pot={gameState.pot}
              sidePots={gameState.sidePots || []}
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
              topRightPosition={myPositionStr ?? undefined}
              reactions={reactions}
              onSendReaction={user?.id ? sendReaction : undefined}
              reactionCooldownMs={cooldownRemainingMs}
            />
          </div>

          {/* Action dock — hero hand left, controls right */}
          <div
            className={`bux-action-dock relative flex h-[100px] min-h-[92px] w-full shrink-0 items-stretch overflow-hidden px-2 py-1.5 [@media(min-width:640px)_and_(min-height:520px)]:h-[156px] [@media(min-width:640px)_and_(min-height:520px)]:min-h-[108px] [@media(min-width:640px)_and_(min-height:520px)]:px-4 [@media(min-width:640px)_and_(min-height:520px)]:py-2 ${isMyTurn ? "ring-1 ring-inset ring-[color:var(--bux-brass)]/40" : ""}`}
          >
            {myPlayer && myPlayer.holeCards && Array.isArray(myPlayer.holeCards) && myPlayer.holeCards.length > 0 && (
              <div className={`absolute left-2 sm:left-4 top-0 bottom-0 z-50 flex flex-col justify-center gap-1 items-start ${myPlayer.status === 'FOLDED' ? 'opacity-50' : ''}`} style={{ visibility: 'visible' }}>
                <span className="font-display text-xs sm:text-sm font-semibold uppercase tracking-wide whitespace-nowrap leading-tight" style={{ color: "var(--bux-brass)" }}>
                  {getHandDescription(myPlayer.holeCards, communityCards, gameState.street || "PREFLOP")}
                </span>
                <div className="flex gap-1.5 sm:gap-2 items-center flex-1 min-h-0">
                {myPlayer.holeCards.map((card: Card, idx: number) => {
                  const getCardImage = (c: Card): string => {
                    const suitMap: Record<string, string> = {
                      "SPADES": "S", "HEARTS": "H", "DIAMONDS": "D", "CLUBS": "C"
                    };
                    const suit = suitMap[c.suit] || c.suit.charAt(0);
                    const rank = c.rank === "10" ? "10" : c.rank;
                    return `${rank}${suit}.png`;
                  };
                  return (
                    <img
                      key={idx}
                      src={`/cards/${getCardImage(card)}`}
                      alt={`${card.rank}${card.suit}`}
                      className="h-[72px] sm:h-[92px] w-auto max-h-[90%] object-contain rounded-lg shadow-lg flex-shrink-0 border"
                      style={{ display: 'block', borderColor: "rgba(196, 165, 116, 0.35)" }}
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                  );
                })}
                </div>
              </div>
            )}
              <div className="relative z-[60] ml-auto flex h-full min-h-0 flex-col items-end justify-center gap-2">
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
                {myPlayer?.isAway && !gameState.showdownActive && (
                  <div className="flex flex-1 items-center justify-center">
                    <button
                      type="button"
                      onClick={handleImBack}
                      className="rounded-lg bg-emerald-600 font-bold text-white shadow-lg hover:bg-emerald-500 transition-colors whitespace-nowrap"
                      style={{
                        minWidth: `var(--action-button-width, 140px)`,
                        height: `var(--action-button-height, 48px)`,
                        paddingLeft: `var(--action-button-padding-x, 24px)`,
                        paddingRight: `var(--action-button-padding-x, 24px)`,
                        fontSize: `var(--action-button-text, 16px)`,
                      }}
                    >
                      I&apos;m back
                    </button>
                  </div>
                )}
                {isMyTurn && !gameState.showdownActive && !myPlayer?.isAway && (
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

        {/* Chat drawer — overlays table; does not shrink felt */}
        {user && (
          <>
            {chatCollapsed && (
              <button
                onClick={() => {
                  setChatCollapsed(false);
                  setUnreadChatCount(0);
                }}
                className="absolute right-0 top-1/2 z-40 flex h-14 w-10 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 shadow-lg"
                style={{
                  background: "color-mix(in srgb, var(--bux-panel) 95%, transparent)",
                  borderColor: "var(--bux-panel-border)",
                }}
                aria-label="Open chat"
              >
                <svg className="h-5 w-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {unreadChatCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                    {unreadChatCount > 99 ? "99+" : unreadChatCount}
                  </span>
                )}
              </button>
            )}
            {!chatCollapsed && (
              <div
                className="bux-chat-drawer absolute bottom-0 right-0 top-0 z-40 flex w-80 max-w-[85vw] flex-col overflow-hidden border-l shadow-2xl"
                style={{
                  background: "color-mix(in srgb, var(--bux-ink-elevated) 97%, transparent)",
                  borderColor: "var(--bux-panel-border)",
                }}
              >
                <div className="flex items-center justify-between border-b px-2 py-1.5" style={{ borderColor: "var(--bux-panel-border)" }}>
                  <span className="font-display text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Table chat
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">Dealer</span>
                    <button
                      onClick={() => setShowDealerMessages(!showDealerMessages)}
                      className={`relative inline-flex items-center rounded-full transition-colors ${
                        showDealerMessages ? "bg-emerald-600" : "bg-slate-600"
                      }`}
                      style={{ height: "20px", width: "36px" }}
                      aria-label="Toggle dealer messages"
                    >
                      <span
                        className={`inline-block rounded-full bg-white transition-transform ${
                          showDealerMessages ? "translate-x-4" : "translate-x-0"
                        }`}
                        style={{ height: "16px", width: "16px", marginLeft: "2px" }}
                      />
                    </button>
                    <button
                      onClick={() => setChatCollapsed(true)}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                      aria-label="Close chat"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <Chat
                    gameId={gameState.id}
                    userId={user.id}
                    userName={user.username || "Player"}
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
            )}
          </>
        )}
      </div>

    </div>
  );
}


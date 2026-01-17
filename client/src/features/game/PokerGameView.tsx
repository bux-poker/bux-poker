import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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

export function PokerGameView() {
  const { id } = useParams<{ id: string }>();
  const [gameState, setGameState] = useState<GameStatePayload | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [turnTimer, setTurnTimer] = useState<{ userId: string; expiresAt: number; duration: number } | null>(null);
  const [nextBlindTime, setNextBlindTime] = useState<string>('--:--');
  const { user } = useAuth();
  const { tournament } = useTournament(gameState?.tournamentId);

  useEffect(() => {
    if (!id) return;

    const socket = getSocket();
    
    // Ensure socket is connected
    if (!socket.connected) {
      socket.connect();
    }

    // Use default namespace - backend handles routing
    socket.emit("join-table", { gameId: id });

    socket.on("game-state", (payload: GameStatePayload) => {
      setGameState(payload);
      setConnecting(false);
      setError(null);
    });

    socket.on("error", (payload: { message: string }) => {
      setError(payload.message);
      setConnecting(false);
    });

    socket.on("connect", () => {
      // Re-join table when reconnected
      socket.emit("join-table", { gameId: id });
    });

    socket.on("game_message", (message) => {
      // Dispatch a custom event to be caught by ChatHooks
      window.dispatchEvent(new CustomEvent('gameMessage', { detail: { gameId: id, message } }));
    });

    socket.on("turn-timer-start", (payload: { gameId: string; userId: string; expiresAt: number; duration: number }) => {
      if (payload.gameId === id) {
        setTurnTimer({ userId: payload.userId, expiresAt: payload.expiresAt, duration: payload.duration });
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
      socket.off("game_message");
      socket.off("turn-timer-start");
      clearInterval(timerInterval);
    };
  }, [id, turnTimer]);

  // Calculate next blind timer based on tournament startedAt
  useEffect(() => {
    console.log('[BLIND TIMER] Tournament data check:', {
      tournament: tournament ? 'exists' : 'null',
      tournamentId: gameState?.tournamentId,
      startedAt: tournament?.startedAt,
      status: tournament?.status,
      blindLevels: tournament?.blindLevels?.length || 0
    });
    
    if (!tournament) {
      console.log('[BLIND TIMER] No tournament data');
      setNextBlindTime('--:--');
      return;
    }
    
    if (!tournament.startedAt) {
      console.log('[BLIND TIMER] Tournament startedAt is null/undefined');
      setNextBlindTime('--:--');
      return;
    }
    
    // Timer only works when tournament is RUNNING (after Start Tournament is clicked)
    // This sets startedAt and status to RUNNING
    if (tournament.status !== 'RUNNING') {
      console.log('[BLIND TIMER] Tournament status is not RUNNING:', tournament.status, '- Timer will work after clicking Start Tournament');
      setNextBlindTime('--:--');
      return;
    }
    
    const calculateNextBlind = () => {
      if (!tournament.startedAt) {
        console.warn('[BLIND TIMER] Tournament startedAt is null/undefined:', tournament);
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

      const blindLevels = tournament.blindLevels || [];
      if (blindLevels.length === 0) {
        setNextBlindTime('--:--');
        return;
      }

      // Find current blind level
      let currentLevelIndex = 0;
      for (let i = 0; i < blindLevels.length; i++) {
        const level = blindLevels[i];
        if (level.duration === null) {
          // Final level (infinite duration)
          currentLevelIndex = i;
          break;
        }
        if (elapsedMinutes <= level.duration) {
          currentLevelIndex = i;
          break;
        }
        elapsedMinutes -= level.duration;
        // Account for break after level
        if (level.breakAfter) {
          elapsedMinutes -= level.breakAfter;
        }
      }

      // Calculate time until next level
      if (currentLevelIndex + 1 < blindLevels.length) {
        const currentLevel = blindLevels[currentLevelIndex];
        const levelDuration = currentLevel.duration || 0;
        const breakDuration = currentLevel.breakAfter || 0;
        const totalLevelTime = (levelDuration + breakDuration) * 60 * 1000; // Convert to ms
        const timeIntoLevel = elapsedMinutes * 60 * 1000;
        const timeUntilNext = totalLevelTime - timeIntoLevel;

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
  const myPosition = myPlayer ? activePlayers.findIndex(p => p.id === myPlayer.id) + 1 : null;
  const myContribution = myPlayer?.contribution || 0;

  return (
    <div className="flex h-screen w-screen flex-col bg-gradient-to-br from-slate-950 to-slate-900 overflow-hidden">
      {/* Top Bar - Game Info */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-3 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">BLINDS</span>
            <span className="text-lg font-bold text-white">{smallBlind}/{bigBlind}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">NEXT BLIND</span>
            <span className="text-lg font-bold text-white">{nextBlindTime}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">TOTAL POT</span>
            <span className="text-lg font-bold text-white">{gameState.pot.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col text-right">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">PLAYERS</span>
            <span className="text-lg font-bold text-white">{activePlayers.length}/{gameState.players.length}</span>
          </div>
          {myPosition && (
            <div className="flex flex-col text-right">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">POSITION</span>
              <span className="text-lg font-bold text-white">{myPosition}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main game area - full screen layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left side - Table and controls */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Table area - takes most of the space */}
          <div className="relative flex-1 overflow-hidden bg-gradient-to-br from-slate-950 to-slate-900 min-h-0">
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
              }))}
              communityCards={communityCards}
              pot={gameState.pot}
              currentBet={gameState.currentBet || 0}
              currentPlayer={gameState.currentTurnUserId}
              smallBlind={smallBlind}
              bigBlind={bigBlind}
              myUserId={user?.id}
            />
          </div>

          {/* Betting controls - fixed at bottom */}
          <div className="border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm relative">
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
              />
          </div>
        </div>

        {/* Right side - Chat */}
        {user && (
          <div className="w-80 border-l border-slate-800 flex-shrink-0">
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
            />
          </div>
        )}
      </div>
    </div>
  );
}


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

interface PlayerViewModel {
  id: string;
  name: string;
  chips: number;
  seatNumber: number;
  status: string;
  holeCards?: Card[];
  avatarUrl?: string;
  userId?: string;
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
  const { user } = useAuth();

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

    return () => {
      socket.off("game-state");
      socket.off("error");
      socket.off("connect");
    };
  }, [id]);

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

  return (
    <div className="flex h-screen w-screen flex-col bg-gradient-to-br from-slate-950 to-slate-900 overflow-hidden">
      {/* Top Bar - Game Info */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-3 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">BLINDS</span>
            <span className="text-lg font-bold text-white">${smallBlind}/${bigBlind}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">NEXT BLIND</span>
            <span className="text-lg font-bold text-white">10:00</span>
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
              players={gameState.players.map((p) => ({
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
              }))}
              communityCards={communityCards}
              pot={gameState.pot}
              currentBet={0}
              currentPlayer={gameState.currentTurnUserId}
              smallBlind={smallBlind}
              bigBlind={bigBlind}
              myUserId={user?.id}
            />
          </div>

          {/* Betting controls - fixed at bottom */}
          <div className="border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
            <BettingControls 
              onAction={handleAction} 
              currentBet={0}
              bigBlind={bigBlind}
              myChips={myPlayer?.chips || 0}
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


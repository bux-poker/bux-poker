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
}

interface GameStatePayload {
  id: string;
  tournamentId?: string;
  tableNumber?: number;
  pot: number;
  communityCards: string;
  players: PlayerViewModel[];
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

    return () => {
      socket.off("game-state");
      socket.off("error");
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

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-900">
      {/* Main game area - full screen layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left side - Table and controls */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Table header */}
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-100">
                Table {gameState.tableNumber ?? ""}
              </h1>
              <p className="text-sm text-slate-400">
                Game ID: {gameState.id}
              </p>
            </div>
          </div>

          {/* Table area - takes most of the space */}
          <div className="flex-1 overflow-auto p-6">
            <PokerTable
              gameId={gameState.id}
              players={gameState.players.map((p) => ({
                id: p.id,
                name: p.name,
                chips: p.chips
              }))}
              communityCards={communityCards}
              pot={gameState.pot}
              currentBet={0}
            />
          </div>

          {/* Betting controls - fixed at bottom */}
          <div className="border-t border-slate-800 bg-slate-900 p-4">
            <BettingControls onAction={handleAction} />
          </div>
        </div>

        {/* Right side - Chat */}
        {user && (
          <div className="w-80 border-l border-slate-800">
            <Chat
              gameId={gameState.id}
              userId={user.id}
              userName={user.username || 'Player'}
              players={chatPlayers}
              spectators={[]}
              userAvatar={user.avatarUrl}
              showPlayerListTab={true}
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


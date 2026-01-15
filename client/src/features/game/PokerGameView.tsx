import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSocket } from "../../services/socket";
import { PokerTable } from "../../components/poker/PokerTable";
import type { Card } from "../../../shared/types/poker";
import { BettingControls } from "../../components/poker/BettingControls";
import { useAuth } from "@shared/features/auth/AuthContext";

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
    const ns = socket.io.uri?.endsWith("/poker")
      ? socket
      : socket.io.engine.transport.name; // placeholder, actual namespace is handled in backend

    // For now, we just use the default namespace and event names as defined in pokerHandler.
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">
            Table {gameState.tableNumber ?? ""}
          </h1>
          <p className="text-sm text-slate-400">
            Game ID: {gameState.id}
          </p>
        </div>
      </div>

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

      <BettingControls onAction={handleAction} />
    </div>
  );
}


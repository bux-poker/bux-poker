import { getIO } from "./tableState.js";

export function postDealerMessage(gameId, io, message) {
  const socket = io || getIO();
  if (!socket) return;

  const dealerMessage = {
    id: `dealer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId: "DEALER",
    userName: "Dealer",
    message,
    timestamp: Date.now(),
    isGameMessage: true,
    isDealerMessage: true,
  };

  socket.to(`game:${gameId}`).emit("game_message", { gameId, message: dealerMessage });
}


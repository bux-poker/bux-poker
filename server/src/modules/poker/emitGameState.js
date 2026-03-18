import { prisma } from "../../config/database.js";
import { buildClientGameState } from "./buildClientGameState.js";

/**
 * Emit current game state to all clients in the game room.
 */
export async function emitGameState(gameId, io, state) {
  if (!io) return;
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: { include: { user: true } }, tournament: true },
  });
  if (game) {
    const payload = buildClientGameState(game, state);
    io.to(`game:${gameId}`).emit("game-state", payload);
  }
}

import { prisma } from "../../config/database.js";
import { buildClientGameState } from "./buildClientGameState.js";

const gameInclude = {
  players: { include: { user: true } },
  tournament: true,
};

/**
 * Emit current game state to each socket in the room with per-viewer payloads
 * (e.g. hole cards hidden for mucked / unrevealed showdown losers).
 */
export async function emitGameState(gameId, io, state) {
  if (!io) return;
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: gameInclude,
  });
  if (!game) return;
  await emitGameStateForGame(gameId, io, game, state);
}

/**
 * When the full `game` row is already loaded (e.g. startHand), skip an extra DB read.
 */
export async function emitGameStateWithGame(gameId, io, game, state) {
  if (!io || !game) return;
  await emitGameStateForGame(gameId, io, game, state);
}

async function emitGameStateForGame(gameId, io, game, state) {
  const room = `game:${gameId}`;
  const sockets = await io.in(room).fetchSockets();
  if (sockets.length === 0) return;
  for (const sock of sockets) {
    const viewerId = sock.data?.userId ?? null;
    const payload = buildClientGameState(game, state, viewerId);
    sock.emit("game-state", payload);
  }
}

import { prisma } from "../../../config/database.js";
import { tableState } from "../../poker/tableState.js";
import { buildClientGameState } from "../../poker/buildClientGameState.js";

/**
 * Register the join-table socket handler.
 * @param {object} socket - Socket.IO socket
 * @param {object} io - Socket.IO server
 * @param {{ startHandForGame: (gameId: string, io: object) => Promise<void> }} deps - startHandForGame from router (avoids circular dep)
 */
export function registerJoinTable(socket, io, { startHandForGame }) {
  socket.on("join-table", async ({ gameId }) => {
    try {
      const game = await prisma.game.findUnique({
        where: { id: gameId },
        include: {
          players: { include: { user: true } },
          tournament: true
        }
      });

      if (!game) {
        socket.emit("error", { message: "Game not found" });
        return;
      }

      for (const room of socket.rooms) {
        if (room.startsWith("game:") && room !== `game:${gameId}`) {
          socket.leave(room);
        }
      }
      socket.join(`game:${gameId}`);

      let state = tableState.get(gameId);
      if (!state && game.status === "ACTIVE" && game.players.length >= 2) {
        if (game.tournament && game.tournament.status === "RUNNING") {
          try {
            // Use namespace server (io) — socket.server can be missing on some Socket.IO builds
            state = await startHandForGame(gameId, io);
          } catch (handError) {
            console.error("[POKER] Error auto-starting hand:", handError);
          }
        }
      }

      state = tableState.get(gameId);
      const payload = buildClientGameState(game, state);

      socket.emit("game-state", payload);

      if (state) {
        io.to(`game:${gameId}`).emit("game-state", payload);
      }
    } catch (err) {
      console.error("join-table error", err?.message || err, err?.stack || err);
      socket.emit("error", { message: "Failed to join table" });
    }
  });
}

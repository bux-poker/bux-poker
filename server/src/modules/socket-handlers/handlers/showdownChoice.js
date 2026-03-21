import { tableState } from "../../poker/tableState.js";
import { emitGameState } from "../../poker/emitGameState.js";
import { tryAccelerateShowdownCleanup } from "../../poker/showdown.js";

/**
 * Loser at showdown chooses to show or muck hole cards (optional reveal phase).
 */
export function registerShowdownChoice(socket, io) {
  socket.on("showdown-choice", async ({ gameId, choice }) => {
    try {
      const userId = socket.data?.userId;
      if (!userId || (choice !== "SHOW" && choice !== "MUCK")) return;

      const state = tableState.get(gameId);
      if (!state?.showdownActive || !state.showdownResults) return;

      const player = state.players.find(
        (p) => String(p.userId) === String(userId)
      );
      if (!player || player.showdownRevealStatus !== "PENDING") return;

      player.showdownRevealStatus = choice;
      tableState.set(gameId, state);

      await emitGameState(gameId, io, state);
      tryAccelerateShowdownCleanup(gameId, io);
    } catch (err) {
      console.error("showdown-choice error", err?.message || err);
    }
  });
}

import { tableState } from "../../poker/tableState.js";
import { emitGameState } from "../../poker/emitGameState.js";
import { tryAccelerateShowdownCleanup } from "../../poker/showdown.js";
import { normalizeUserId } from "../../poker/normalizeUserId.js";

/**
 * After showdown, any player dealt in this hand (including folders) may show or muck.
 * Uses payload userId like player-action — socket.session userId is often unset on the poker socket.
 */
export function registerShowdownChoice(socket, io) {
  socket.on("showdown-choice", async ({ gameId, choice, userId: reportedUserId }) => {
    try {
      const socketUid =
        socket.data?.userId != null ? normalizeUserId(socket.data.userId) : null;
      const payloadUid =
        reportedUserId != null ? normalizeUserId(reportedUserId) : null;
      if (socketUid && payloadUid && socketUid !== payloadUid) {
        console.warn("[POKER] showdown-choice: socket userId vs payload mismatch, ignoring");
        return;
      }
      const userId = payloadUid ?? socketUid;
      if (!userId || (choice !== "SHOW" && choice !== "MUCK")) return;

      const state = tableState.get(gameId);
      if (!state?.showdownActive || !state.showdownResults) return;

      const player = state.players.find(
        (p) => normalizeUserId(p.userId) === userId
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

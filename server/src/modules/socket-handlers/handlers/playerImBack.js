import { tableState, turnTimers } from "../../poker/tableState.js";
import { emitGameState } from "../../poker/emitGameState.js";
import { startTurnTimer } from "../../poker/turnTimers.js";
import { normalizeUserId } from "../../poker/normalizeUserId.js";

/**
 * Clear AWAY status when a human returns to the table.
 */
export function registerPlayerImBack(socket, io) {
  socket.on("player-im-back", async ({ gameId, userId: reportedUserId }) => {
    try {
      const socketUid =
        socket.data?.userId != null ? normalizeUserId(socket.data.userId) : null;
      const payloadUid =
        reportedUserId != null ? normalizeUserId(reportedUserId) : null;
      if (socketUid && payloadUid && socketUid !== payloadUid) {
        console.warn("[POKER] player-im-back: socket userId vs payload mismatch");
        return;
      }
      const userId = payloadUid ?? socketUid;
      if (!userId || !gameId) return;

      const state = tableState.get(gameId);
      if (!state) return;

      const player = state.players.find(
        (p) => normalizeUserId(p.userId) === userId
      );
      if (!player || !player.isAway) return;

      player.isAway = false;
      tableState.set(gameId, state);
      await emitGameState(gameId, io, state);

      if (normalizeUserId(state.currentTurnUserId) === userId) {
        startTurnTimer(gameId, userId, io);
      }
    } catch (err) {
      console.error("[POKER] player-im-back error:", err?.message || err);
    }
  });
}

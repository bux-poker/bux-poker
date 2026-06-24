import {
  tableState,
  turnTimers,
  clearPlayerAway,
  isPlayerAway,
} from "../../poker/tableState.js";
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

      if (!isPlayerAway(gameId, userId)) return;

      clearPlayerAway(gameId, userId);

      const state = tableState.get(gameId);
      await emitGameState(gameId, io, state ?? null);

      if (
        state &&
        normalizeUserId(state.currentTurnUserId) === userId
      ) {
        startTurnTimer(gameId, userId, io);
      }
    } catch (err) {
      console.error("[POKER] player-im-back error:", err?.message || err);
    }
  });
}

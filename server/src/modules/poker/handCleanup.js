/**
 * Clear table state and start the next hand. Used when a hand has already ended
 * (e.g. "skip award" path) so we don't leave the table stuck with hasActiveHand true.
 */
import { prisma } from "../../config/database.js";
import { tableState } from "./tableState.js";
import { resetPlayerRowIfNotEliminated } from "./safeHandCleanupDb.js";

/**
 * @param {string} gameId
 * @param {object} io - socket server
 * @param {object} state - current table state (will be cleared)
 * @param {(id: string, io: object) => Promise<void>} startHandForGame
 * @param {number} delayMs - delay before cleanup (default 500)
 */
export function cleanupHandAndStartNext(gameId, io, state, startHandForGame, delayMs = 500) {
  (async () => {
    await prisma.game
      .update({ where: { id: gameId }, data: { pot: 0 } })
      .catch((err) => console.error("[POKER] handCleanup: failed to zero pot:", err?.message));

    setTimeout(() => {
    const savedPlayers = [...state.players];
    tableState.delete(gameId);

    const resetPromises = savedPlayers
      .filter((p) => p.status !== "ELIMINATED" && p.chips > 0)
      .map((p) =>
        resetPlayerRowIfNotEliminated(p.id).catch((err) => {
          console.error(`[POKER] Error resetting player ${p.id} in hand cleanup:`, err?.message);
        })
      );

    Promise.all(resetPromises).then(async () => {
      const gameForNext = await prisma.game
        .findUnique({
          where: { id: gameId },
          include: { players: { include: { user: true } }, tournament: true },
        })
        .catch(() => null);

      if (
        gameForNext &&
        gameForNext.players.filter((p) => p.status === "ACTIVE").length >= 2 &&
        io
      ) {
        try {
          await startHandForGame(gameId, io);
          console.log(`[POKER] Started next hand after hand-already-ended cleanup for game ${gameId}`);
        } catch (err) {
          console.error("[POKER] Error starting new hand after hand-already-ended cleanup:", err?.message);
        }
      }
    });
  }, delayMs);
  })();
}

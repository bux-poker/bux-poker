import { prisma } from "../../config/database.js";

/**
 * After a tournament is marked COMPLETED/CANCELLED, async poker paths (fold-win, moveToNextPlayer)
 * may still run with stale in-memory state and would award pots / write chips incorrectly.
 * Call before any "one player left" pot award.
 */
export async function shouldBlockFoldWinPotAward(gameId) {
  const g = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      tournamentId: true,
      tournament: { select: { status: true } },
    },
  });
  const status = g?.tournament?.status;
  if (status === "COMPLETED" || status === "CANCELLED") {
    console.warn(
      `[POKER] Block fold-win pot award (game ${gameId}) — tournament status=${status}`
    );
    return true;
  }
  return false;
}

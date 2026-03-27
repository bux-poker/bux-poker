import { prisma } from "../../config/database.js";

/**
 * Cash games have no tournament; multi-instance Fly machines each hold timers — check DB
 * before acting so a completed tournament on one machine does not auto-fold on another.
 */
export async function isTournamentGameTerminal(gameId) {
  const g = await prisma.game.findUnique({
    where: { id: gameId },
    select: { tournament: { select: { status: true } } },
  });
  const s = g?.tournament?.status;
  return s === "COMPLETED" || s === "CANCELLED";
}

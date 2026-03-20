import { prisma } from "../../config/database.js";

/**
 * After a hand, reset a surviving player's row for the next hand.
 * Never overwrites ELIMINATED — delayed cleanup must not "resurrect" busted players
 * if bust was persisted before this timeout ran.
 */
export function resetPlayerRowIfNotEliminated(playerId) {
  return prisma.player.updateMany({
    where: { id: playerId, status: { not: "ELIMINATED" } },
    data: { status: "ACTIVE", holeCards: "", lastAction: null },
  });
}

/** Clear hole cards on rows already eliminated (no status change). */
export function clearHoleCardsIfEliminated(playerId) {
  return prisma.player.updateMany({
    where: { id: playerId, status: "ELIMINATED" },
    data: { holeCards: "", lastAction: null },
  });
}

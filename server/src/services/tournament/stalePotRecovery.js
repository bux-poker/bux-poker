import { prisma } from "../../config/database.js";

/**
 * DB pot > 0 while there is no active in-memory hand — invariant violation.
 * We do not invent winners or redistribute chips; that would fake a result.
 * Zeroing the DB pot unblocks dealing; chip total can drop until hand-end paths are fixed
 * so this path is never hit (award + pot=0 + clear state in one coherent sequence).
 *
 * @param {string} gameId
 * @param {number} potAmount
 * @returns {Promise<void>}
 */
export async function awardStalePotAndZeroGame(gameId, potAmount) {
  if (!gameId || (potAmount ?? 0) <= 0) {
    await prisma.game.update({ where: { id: gameId }, data: { pot: 0 } }).catch(() => {});
    return;
  }

  console.error(
    `[TOURNAMENT] STALE POT BUG: game ${gameId} had pot=${potAmount} but no active hand – pot not awarded. Zeroing DB pot to unblock table; investigate hand-end / consolidation ordering.`
  );

  await prisma.game.update({ where: { id: gameId }, data: { pot: 0 } }).catch(() => {});
}

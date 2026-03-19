import { prisma } from "../../config/database.js";

/**
 * "Stale pot" = game.pot > 0 in DB but no active hand. This is a BUG: when a hand ends
 * we should always award the pot to the winner and persist pot=0. If we're here, that
 * didn't happen (e.g. race where we cleared state before the DB update completed).
 *
 * We do NOT award to anyone – we don't know who won. We zero the pot so the table can
 * start the next hand, and log. Chips in that pot are lost. Fix hand-end paths so we
 * always award to the winner and persist before clearing state; then we never hit this.
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
    `[TOURNAMENT] STALE POT BUG: game ${gameId} had pot=${potAmount} but no active hand – we never awarded the winner. Zeroing pot so table can continue; chips lost. Fix hand-end paths to always award winner and persist pot=0 before clearing state.`
  );

  await prisma.game.update({ where: { id: gameId }, data: { pot: 0 } }).catch(() => {});
}

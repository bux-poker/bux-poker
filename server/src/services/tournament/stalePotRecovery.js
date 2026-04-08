import { prisma } from "../../config/database.js";

/**
 * DB `game.pot` should only be non-zero while a hand is logically in progress and
 * mirrored by in-memory state, or briefly during persistence. If we see pot > 0 with
 * no defensible in-memory hand, we must NOT zero it — that destroyed chip conservation.
 *
 * Log loudly; operators fix via proper hand completion / persistence.
 *
 * @param {string} gameId
 * @param {number} potAmount
 * @param {string} [context]
 */
export function logUnreconciledDbPot(gameId, potAmount, context = "") {
  if (!gameId || (potAmount ?? 0) <= 0) return;
  console.error(
    `[TOURNAMENT] UNRECONCILED DB POT: game=${gameId} pot=${potAmount} ${context}. Not zeroing — investigate hand-completion / persistence.`
  );
}

/**
 * @deprecated Use logUnreconciledDbPot. Never zero pots without a matching stack update.
 */
export async function awardStalePotAndZeroGame(gameId, potAmount) {
  logUnreconciledDbPot(
    gameId,
    potAmount,
    "(legacy caller — should use fail-closed path instead)"
  );
  /* intentionally do not update DB */
}

/**
 * Fail-closed guard for starting a new hand: unreconciled DB pot blocks deal.
 * @param {string} gameId
 * @returns {Promise<{ ok: true } | { ok: false, pot: number }>}
 */
export async function assertDbPotZeroForNewHand(gameId) {
  const row = await prisma.game
    .findUnique({
      where: { id: gameId },
      select: { pot: true },
    })
    .catch(() => null);
  const pot = row?.pot ?? 0;
  if (pot > 0) {
    logUnreconciledDbPot(gameId, pot, "(blocking startHand)");
    return { ok: false, pot };
  }
  return { ok: true };
}

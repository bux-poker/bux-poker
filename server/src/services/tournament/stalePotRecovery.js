import { prisma } from "../../config/database.js";
import { hasActiveHand, tableState } from "../../modules/poker/tableState.js";

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
  await reconcileOrphanDbPotIfNoLiveHand(gameId);
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

/**
 * If Postgres still holds chips on Game.pot but this process has no in-memory hand, the pot is
 * stranded (hand finished or crashed). Credit the lowest non-eliminated seat and zero the row so
 * startHand, blind-barrier acks, and consolidation can proceed without destroying chips.
 * @param {string} gameId
 * @returns {Promise<boolean>} true if a DB update was applied
 */
export async function reconcileOrphanDbPotIfNoLiveHand(gameId) {
  if (!gameId) return false;
  if (hasActiveHand(gameId)) return false;
  const st = tableState.get(gameId);
  if (st && !st.handEnded) return false;
  if (st && (st.pot ?? 0) > 0) return false;

  const row = await prisma.game
    .findUnique({
      where: { id: gameId },
      select: { pot: true, status: true, tableNumber: true },
    })
    .catch(() => null);
  const pot = row?.pot ?? 0;
  if (!row || row.status !== "ACTIVE" || pot <= 0) return false;

  const players = await prisma.player.findMany({
    where: { gameId, status: { not: "ELIMINATED" } },
    orderBy: { seatNumber: "asc" },
    select: { id: true },
  });
  if (players.length === 0) {
    logUnreconciledDbPot(
      gameId,
      pot,
      `(reconcile: no non-eliminated seat on table ${row.tableNumber})`
    );
    return false;
  }

  const recipientId = players[0].id;
  await prisma.$transaction([
    prisma.player.update({
      where: { id: recipientId },
      data: { chips: { increment: pot } },
    }),
    prisma.game.update({
      where: { id: gameId },
      data: { pot: 0 },
    }),
  ]);
  console.warn(
    `[TOURNAMENT] Reconciled orphan DB pot ${pot} on game ${gameId} (table ${row.tableNumber}) → player ${recipientId} (lowest non-eliminated seat)`
  );
  return true;
}

/**
 * @param {string} tournamentId
 */
export async function reconcileOrphanDbPotsForTournament(tournamentId) {
  const rows = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    select: { id: true },
  });
  let n = 0;
  for (const r of rows) {
    if (await reconcileOrphanDbPotIfNoLiveHand(r.id)) n++;
  }
  return n;
}

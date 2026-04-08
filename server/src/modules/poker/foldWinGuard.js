import { prisma } from "../../config/database.js";

/** Main pot plus chips still in the current betting round (before they are merged into state.pot). */
export function resolveInMemoryPotTotalChips(state) {
  if (!state) return 0;
  const round =
    typeof state.bettingRound?.getTotalPot === "function"
      ? state.bettingRound.getTotalPot() || 0
      : 0;
  return (state.pot || 0) + round;
}

/**
 * Fold-win was blocked because the tournament already finished. Do not persist player stacks here —
 * DB may already reflect the real winner and a blind persist would clobber it. If the in-memory
 * hand still holds pot chips that were never written to `Game.pot`, raise `Game.pot` so Postgres
 * does not end up short (chip audit / consolidation).
 */
export async function persistBlockedFoldWinPotToDatabase(gameId, state) {
  const total = resolveInMemoryPotTotalChips(state);
  if (total <= 0) return;
  const g = await prisma.game
    .findUnique({
      where: { id: gameId },
      select: { pot: true },
    })
    .catch(() => null);
  const dbPot = Number(g?.pot ?? 0);
  if (total <= dbPot) return;
  await prisma.game
    .update({
      where: { id: gameId },
      data: { pot: total },
    })
    .catch((err) => {
      console.error(
        `[POKER] Failed to flush blocked fold-win pot to DB (game ${gameId}):`,
        err?.message
      );
    });
  console.warn(
    `[POKER] Fold-win blocked (game ${gameId}): set Game.pot to ${total} (was ${dbPot}) so chips are not stranded in memory only`
  );
}

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

import { prisma } from "../../config/database.js";

/**
 * Write every non-eliminated seat's chip count from in-memory hand state to the DB.
 *
 * Betting only updates chips in memory until the hand resolves. Code paths that only
 * `prisma.player.update` the pot winner (fold wins) or only showdown "active" players
 * left everyone else with stale balances from the previous hand. The next `startHand`
 * loads from Postgres and stacks desync — chips look stolen, halved, or winners show 0.
 */
export async function persistAllPlayerStacksFromHandState(
  state,
  logTag = "[persistHandStacks]"
) {
  if (!state?.players?.length) return;
  await Promise.all(
    state.players
      .filter((p) => p.status !== "ELIMINATED")
      .map((p) =>
        prisma.player
          .update({
            where: { id: p.id },
            data: { chips: Math.max(0, p.chips ?? 0) },
          })
          .catch((err) => {
            if (err?.code === "P2025") return;
            console.error(`${logTag} player ${p.id}:`, err);
          })
      )
  );
}

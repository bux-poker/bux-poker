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
            data: {
              chips: (() => {
                const c = p.chips ?? 0;
                if (c < 0) {
                  console.error(
                    `${logTag} NEGATIVE in-memory chips for player ${p.id} (${c}) — clamping to 0; chip pool may be wrong (investigate showdown/reconcile)`
                  );
                }
                return Math.max(0, c);
              })(),
            },
          })
          .catch((err) => {
            if (err?.code === "P2025") return;
            console.error(`${logTag} player ${p.id}:`, err);
          })
      )
  );
}

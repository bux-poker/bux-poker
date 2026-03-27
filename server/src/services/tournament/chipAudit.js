import { prisma } from "../../config/database.js";
import { hasActiveHand } from "../../modules/poker/tableState.js";

/**
 * Chip pool invariant: every seated `Player` row was created with `startingChips`.
 * Total in play = (number of player rows in this tournament) × startingChips.
 * Registration count can differ (registered but not seated, or admin/test seating edge cases),
 * so we must NOT use registration count alone for conservation math.
 */
async function getExpectedChipTotal(tournamentId, startingChips) {
  const playerRowCount = await prisma.player.count({
    where: { game: { tournamentId } },
  });
  return { expectedTotal: playerRowCount * startingChips, playerRowCount };
}

/**
 * Audit chip conservation: total chips in tournament must equal expected (player rows × startingChips).
 * Logs only — never adjusts stacks. Correct outcomes come from a single pot-award path per hand.
 */
export async function auditChipConservation(tournamentId) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      registrations: { where: { status: "CONFIRMED" } },
      games: { include: { players: true } },
    },
  });
  if (!tournament) return;

  const { expectedTotal, playerRowCount } = await getExpectedChipTotal(
    tournamentId,
    tournament.startingChips
  );
  const regCount = tournament.registrations?.length ?? 0;
  if (regCount !== playerRowCount) {
    console.warn(
      `[TOURNAMENT] Chip audit: CONFIRMED registrations (${regCount}) !== player rows (${playerRowCount}) for ${tournamentId} — using player rows for expected total`
    );
  }

  let playerChipsTotal = 0;
  let gamePotTotal = 0;
  for (const game of tournament.games || []) {
    gamePotTotal += game.pot ?? 0;
    for (const p of game.players || []) {
      playerChipsTotal += p.chips ?? 0;
    }
  }
  const actualTotal = playerChipsTotal + gamePotTotal;
  const activeHandCount = (tournament.games || []).filter((g) =>
    hasActiveHand(g.id)
  ).length;
  if (actualTotal !== expectedTotal) {
    const msg = `[TOURNAMENT] CHIP CONSERVATION ${
      activeHandCount > 0 ? "PENDING" : "VIOLATION"
    }: tournament ${tournamentId} has ${actualTotal} chips (players: ${playerChipsTotal}, game pots: ${gamePotTotal}), expected ${expectedTotal} (${playerRowCount} player rows × ${tournament.startingChips} starting). Difference: ${
      actualTotal - expectedTotal
    }${activeHandCount > 0 ? `, activeHands=${activeHandCount}` : ""}`;
    if (activeHandCount > 0) {
      console.warn(msg);
    } else {
      console.error(msg);
    }
  } else {
    console.log(
      `[TOURNAMENT] Chip audit OK: ${actualTotal} chips (expected ${expectedTotal})`
    );
  }
}

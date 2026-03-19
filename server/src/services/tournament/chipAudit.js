import { prisma } from "../../config/database.js";

/**
 * Audit chip conservation: total chips in tournament must equal expected (registrations * startingChips).
 * Logs error if mismatch - chips must NEVER be created or destroyed.
 */
export async function auditChipConservation(tournamentId) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      registrations: { where: { status: "CONFIRMED" } },
      games: { include: { players: true } }
    }
  });
  if (!tournament) return;
  const expectedTotal = tournament.registrations.length * tournament.startingChips;
  let playerChipsTotal = 0;
  let gamePotTotal = 0;
  for (const game of tournament.games || []) {
    gamePotTotal += game.pot ?? 0;
    for (const p of game.players || []) {
      playerChipsTotal += p.chips ?? 0;
    }
  }
  const actualTotal = playerChipsTotal + gamePotTotal;
  if (actualTotal !== expectedTotal) {
    console.error(`[TOURNAMENT] CHIP CONSERVATION VIOLATION: tournament ${tournamentId} has ${actualTotal} chips (players: ${playerChipsTotal}, game pots: ${gamePotTotal}), expected ${expectedTotal} (${tournament.registrations.length} players × ${tournament.startingChips} starting). Difference: ${actualTotal - expectedTotal}`);
  } else {
    console.log(`[TOURNAMENT] Chip audit OK: ${actualTotal} chips (expected ${expectedTotal})`);
  }
}

/**
 * At tournament completion, force chip conservation by reconciling any drift to the sole winner.
 * This is a safety net for edge-case race conditions across hand cleanup/consolidation.
 */
export async function reconcileChipConservationOnCompletion(tournamentId) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      registrations: { where: { status: "CONFIRMED" } },
      games: { include: { players: true } }
    }
  });
  if (!tournament) return;

  const expectedTotal = tournament.registrations.length * tournament.startingChips;
  let playerChipsTotal = 0;
  let gamePotTotal = 0;
  for (const game of tournament.games || []) {
    gamePotTotal += game.pot ?? 0;
    for (const p of game.players || []) {
      playerChipsTotal += p.chips ?? 0;
    }
  }
  const actualTotal = playerChipsTotal + gamePotTotal;
  const diff = expectedTotal - actualTotal;
  if (diff === 0) return;

  const winner = await prisma.player.findFirst({
    where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } },
    orderBy: { chips: "desc" }
  });
  if (!winner) {
    console.error(`[TOURNAMENT] CHIP RECONCILE FAILED: no winner found for ${tournamentId}, diff=${diff}`);
    return;
  }

  const newChips = Math.max(0, (winner.chips || 0) + diff);
  await prisma.player.update({
    where: { id: winner.id },
    data: { chips: newChips }
  });
  // Zero lingering game pots so all chips sit with players at completion.
  await prisma.game.updateMany({
    where: { tournamentId },
    data: { pot: 0 }
  });

  console.warn(
    `[TOURNAMENT] CHIP RECONCILE APPLIED: tournament ${tournamentId}, expected=${expectedTotal}, actual=${actualTotal}, diff=${diff}, winner=${winner.id}, chips ${winner.chips} -> ${newChips}`
  );
}

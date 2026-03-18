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

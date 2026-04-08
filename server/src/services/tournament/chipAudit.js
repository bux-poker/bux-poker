import { prisma } from "../../config/database.js";
import { hasActiveHand, tableState } from "../../modules/poker/tableState.js";

/** Pot accumulated in memory for a table (DB `Game.pot` is often 0 mid-hand). */
function inMemoryPotForGame(gameId) {
  const state = tableState.get(gameId);
  if (!state) return 0;
  let fromRound = 0;
  const r = state.bettingRound;
  if (r && typeof r.getTotalPot === "function") {
    try {
      const x = r.getTotalPot();
      fromRound = typeof x === "number" && !Number.isNaN(x) ? x : 0;
    } catch {
      fromRound = 0;
    }
  }
  return (state.pot ?? 0) + fromRound;
}

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
  const activeGames = (tournament.games || []).filter((g) =>
    hasActiveHand(g.id)
  );
  const activeHandCount = activeGames.length;
  let inMemoryPotSum = 0;
  for (const g of activeGames) {
    inMemoryPotSum += inMemoryPotForGame(g.id);
  }
  const reconciledTotal = actualTotal + inMemoryPotSum;

  if (actualTotal !== expectedTotal) {
    const diff = actualTotal - expectedTotal;
    const reconciledOk =
      activeHandCount > 0 && reconciledTotal === expectedTotal;
    const msg = `[TOURNAMENT] CHIP CONSERVATION ${
      activeHandCount > 0 && !reconciledOk ? "PENDING" : reconciledOk ? "OK_RECONCILED" : "VIOLATION"
    }: tournament ${tournamentId} DB total ${actualTotal} (players ${playerChipsTotal}, game pots ${gamePotTotal}), expected ${expectedTotal} (${playerRowCount} rows × ${tournament.startingChips}). Diff ${diff}${
      activeHandCount > 0
        ? `, activeHands=${activeHandCount}, inMemoryPotSum=${inMemoryPotSum}, db+memory=${reconciledTotal}`
        : ""
    }`;
    if (reconciledOk) {
      console.log(
        `${msg} — matches after adding in-flight tableState pots (not a chip leak).`
      );
    } else if (activeHandCount > 0) {
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

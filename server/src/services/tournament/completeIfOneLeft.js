import { prisma } from "../../config/database.js";
import { auditChipConservation } from "./chipAudit.js";
import { clearAllStateForGames } from "../../modules/poker/tableState.js";

/**
 * If exactly one player has chips and is not eliminated, mark tournament COMPLETED.
 * Call after any hand that awards the pot so we complete when the last opponent folds.
 * @param {string} tournamentId
 * @returns {Promise<boolean>} true if tournament was completed
 */
export async function completeTournamentIfOneLeft(tournamentId) {
  const count = await prisma.player.count({
    where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } }
  });
  if (count !== 1) return false;

  const winner = await prisma.player.findFirst({
    where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } },
    include: { user: true, game: true }
  });
  if (!winner) return false;

  const current = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true }
  });
  if (current?.status === "COMPLETED") return true;

  const verifyCount = await prisma.player.count({
    where: { game: { tournamentId }, chips: { gt: 0 }, status: { not: "ELIMINATED" } }
  });
  if (verifyCount !== 1) return false;

  await prisma.player.update({
    where: { id: winner.id },
    data: { finishingPlace: 1 }
  });
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { status: "COMPLETED" }
  });

  const gameRows = await prisma.game.findMany({
    where: { tournamentId },
    select: { id: true },
  });
  clearAllStateForGames(gameRows.map((r) => r.id));

  await auditChipConservation(tournamentId);

  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { games: { include: { players: { include: { user: true } } } } }
    });
    if (tournament) {
      const { applyLeagueGamePoints } = await import("../league/applyLeagueGamePoints.js");
      await applyLeagueGamePoints(tournamentId);
      const { postTournamentWinnersEmbed } = await import("../../discord/bot.js");
      await postTournamentWinnersEmbed(tournament);
    }
  } catch (err) {
    console.error("[TOURNAMENT] Error posting winners embed:", err);
  }

  console.log(`[TOURNAMENT] Completed tournament ${tournamentId} - one player left (winner: ${winner.user?.username || winner.id})`);
  return true;
}

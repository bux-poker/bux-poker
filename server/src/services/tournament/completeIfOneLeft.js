import { prisma } from "../../config/database.js";
import { auditChipConservation } from "./chipAudit.js";
import { ensureTournamentPrizeClaim } from "../prizes/prizeClaims.js";
import {
  clearAllStateForGames,
  hasActiveHand,
} from "../../modules/poker/tableState.js";

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

  const activeGames = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    select: { id: true, tableNumber: true },
  });
  for (const g of activeGames) {
    if (hasActiveHand(g.id)) {
      console.log(
        `[TOURNAMENT] Deferring completion: active hand still in memory on game ${g.id} (table ${g.tableNumber ?? "?"})`
      );
      return false;
    }
  }

  await prisma.$transaction(async (tx) => {
    const gamesWithPot = await tx.game.findMany({
      where: { tournamentId },
      select: { pot: true },
    });
    const potSum = gamesWithPot.reduce((s, g) => s + (g.pot ?? 0), 0);

    await tx.player.update({
      where: { id: winner.id },
      data: {
        finishingPlace: 1,
        ...(potSum > 0 ? { chips: { increment: potSum } } : {}),
      },
    });
    await tx.tournament.update({
      where: { id: tournamentId },
      data: { status: "COMPLETED" },
    });
    if (potSum > 0) {
      await tx.game.updateMany({
        where: { tournamentId },
        data: { pot: 0 },
      });
      console.log(
        `[TOURNAMENT] Credited ${potSum} from lingering game pot(s) to winner before completion (${tournamentId})`
      );
    }
  });

  const gameRows = await prisma.game.findMany({
    where: { tournamentId },
    select: { id: true },
  });
  clearAllStateForGames(gameRows.map((r) => r.id));

  await ensureTournamentPrizeClaim(tournamentId, winner.userId, 1).catch((err) =>
    console.error("[PRIZES] ensure claim for winner:", err?.message || err)
  );

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

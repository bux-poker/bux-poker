import { prisma } from "../../config/database.js";
import {
  updateTournamentEmbeds,
  postLeagueLegCancelledEmbed,
} from "../../discord/bot.js";
import { maybeMarkLeagueCompleted } from "./applyLeagueGamePoints.js";

/**
 * At T-2m: fewer than 5 confirmed registrations — cancel leg, no points.
 */
export async function cancelLeagueLegInsufficient(tournamentId) {
  const leagueGame = await prisma.leagueGame.findFirst({
    where: { tournamentId },
  });
  if (!leagueGame) return false;

  const confirmed = await prisma.tournamentRegistration.count({
    where: { tournamentId, status: "CONFIRMED" },
  });
  if (confirmed >= 5) return false;

  await prisma.leagueGame.update({
    where: { id: leagueGame.id },
    data: {
      registrationCountAtClose: confirmed,
      completedAt: new Date(),
    },
  });

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { status: "CANCELLED" },
  });

  try {
    await updateTournamentEmbeds(tournamentId);
  } catch (e) {
    console.error("[LEAGUE] updateTournamentEmbeds on cancel:", e);
  }

  try {
    await postLeagueLegCancelledEmbed(tournamentId, confirmed);
  } catch (e) {
    console.error("[LEAGUE] postLeagueLegCancelledEmbed:", e);
  }

  await maybeMarkLeagueCompleted(leagueGame.leagueId);
  return true;
}

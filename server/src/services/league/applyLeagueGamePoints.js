import { prisma } from "../../config/database.js";
import { getLeaguePointsDistribution } from "./leaguePoints.js";

/**
 * After a league leg tournament completes: award points from finishing places + registration ladder.
 * Idempotent via LeagueGame.pointsAwardedAt.
 */
export async function applyLeagueGamePoints(tournamentId) {
  const leagueGame = await prisma.leagueGame.findFirst({
    where: { tournamentId },
    include: { league: true },
  });
  if (!leagueGame || leagueGame.pointsAwardedAt) return;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true },
  });
  if (!tournament || tournament.status !== "COMPLETED") return;

  const count = leagueGame.registrationCountAtClose;
  if (count == null || count < 5) {
    await prisma.leagueGame.update({
      where: { id: leagueGame.id },
      data: { completedAt: leagueGame.completedAt ?? new Date() },
    });
    return;
  }

  const distribution = getLeaguePointsDistribution(count);
  if (distribution.length === 0) return;

  const players = await prisma.player.findMany({
    where: { game: { tournamentId } },
    select: { userId: true, finishingPlace: true },
  });

  const awards = [];
  for (const p of players) {
    if (p.finishingPlace == null) continue;
    const idx = p.finishingPlace - 1;
    if (idx < 0 || idx >= distribution.length) continue;
    const pts = distribution[idx];
    awards.push({ userId: p.userId, finishingPlace: p.finishingPlace, pts });
  }

  await prisma.$transaction(async (tx) => {
    for (const { userId, finishingPlace, pts } of awards) {
      const existing = await tx.leagueStanding.findUnique({
        where: {
          leagueId_userId: { leagueId: leagueGame.leagueId, userId },
        },
      });
      if (existing) {
        const bestFinish =
          existing.bestFinish == null
            ? finishingPlace
            : Math.min(existing.bestFinish, finishingPlace);
        await tx.leagueStanding.update({
          where: { id: existing.id },
          data: {
            points: existing.points + pts,
            gamesPlayed: existing.gamesPlayed + 1,
            bestFinish,
          },
        });
      } else {
        await tx.leagueStanding.create({
          data: {
            leagueId: leagueGame.leagueId,
            userId,
            points: pts,
            gamesPlayed: 1,
            bestFinish: finishingPlace,
          },
        });
      }
    }

    await tx.leagueGame.update({
      where: { id: leagueGame.id },
      data: {
        pointsAwardedAt: new Date(),
        completedAt: leagueGame.completedAt ?? new Date(),
      },
    });
  });

  await maybeMarkLeagueCompleted(leagueGame.leagueId);
}

async function maybeMarkLeagueCompleted(leagueId) {
  const games = await prisma.leagueGame.findMany({
    where: { leagueId },
    include: { tournament: { select: { status: true } } },
  });
  if (games.length === 0) return;
  const allDone = games.every(
    (g) =>
      g.tournament.status === "COMPLETED" || g.tournament.status === "CANCELLED"
  );
  if (allDone) {
    await prisma.league.update({
      where: { id: leagueId },
      data: { status: "COMPLETED" },
    });
  }
}

export { maybeMarkLeagueCompleted };

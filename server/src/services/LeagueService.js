import { prisma } from "../config/database.js";

/** League domain service */
export class LeagueService {
  async listLeagues() {
    return prisma.league.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });
  }

  async getLeagueById(id) {
    const league = await prisma.league.findUnique({
      where: { id },
      include: {
        standings: {
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
          },
        },
        games: {
          orderBy: { gameNumber: "asc" },
          include: {
            tournament: {
              select: {
                id: true,
                name: true,
                startTime: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!league) return null;

    const standings = [...league.standings].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const af = a.bestFinish ?? 999;
      const bf = b.bestFinish ?? 999;
      return af - bf;
    });

    return { ...league, standings };
  }

  /** Leagues that still have at least one leg not finished (for public list). */
  async listActiveLeagues() {
    const leagues = await prisma.league.findMany({
      where: { status: { in: ["PLANNED", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
      include: {
        games: {
          include: {
            tournament: { select: { id: true, status: true, startTime: true } },
          },
        },
      },
    });
    return leagues.filter((L) =>
      L.games.some(
        (g) =>
          g.tournament.status !== "COMPLETED" && g.tournament.status !== "CANCELLED"
      )
    );
  }
}


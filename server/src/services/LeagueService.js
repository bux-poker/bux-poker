import { prisma } from "../config/database.js";

export class LeagueService {
  async listLeagues() {
    return prisma.league.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });
  }

  async getLeagueById(id) {
    return prisma.league.findUnique({
      where: { id },
      include: {
        standings: {
          orderBy: { points: "desc" }
        },
        games: true
      }
    });
  }
}


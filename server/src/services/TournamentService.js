import { prisma } from "../config/database.js";

export class TournamentService {
  async listTournaments() {
    return prisma.tournament.findMany({
      orderBy: { startTime: "asc" }
    });
  }

  async getTournamentById(id) {
    return prisma.tournament.findUnique({
      where: { id },
      include: {
        registrations: true,
        games: true
      }
    });
  }

  async createTournament(data) {
    // TODO: add validation and admin auth upstream
    return prisma.tournament.create({
      data
    });
  }

  async registerForTournament({ tournamentId, userId }) {
    return prisma.tournamentRegistration.upsert({
      where: {
        tournamentId_userId: { tournamentId, userId }
      },
      create: {
        tournamentId,
        userId,
        status: "CONFIRMED"
      },
      update: {
        status: "CONFIRMED"
      }
    });
  }
}


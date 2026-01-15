import { prisma } from "../config/database.js";

export class TournamentService {
  async listTournaments() {
    const tournaments = await prisma.tournament.findMany({
      orderBy: { startTime: "asc" },
      include: {
        registrations: {
          select: {
            id: true,
            userId: true,
            status: true,
          },
        },
        posts: {
          include: {
            server: {
              select: {
                id: true,
                serverId: true,
                serverName: true,
                inviteLink: true,
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Transform to include registeredCount and server info
    return tournaments.map((tournament) => ({
      ...tournament,
      registeredCount: tournament.registrations.filter(
        (r) => r.status === "CONFIRMED" || r.status === "PENDING"
      ).length,
      servers: tournament.posts.map((post) => ({
        id: post.server.id,
        serverId: post.server.serverId,
        serverName: post.server.serverName,
        inviteLink: post.server.inviteLink,
      })),
    }));
  }

  async getTournamentById(id) {
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        registrations: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
                discordId: true,
              },
            },
          },
        },
        games: true,
        posts: {
          include: {
            server: {
              select: {
                id: true,
                serverId: true,
                serverName: true,
                inviteLink: true,
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!tournament) return null;

    // Add registeredCount and server info
    return {
      ...tournament,
      registeredCount: tournament.registrations.filter(
        (r) => r.status === "CONFIRMED" || r.status === "PENDING"
      ).length,
      servers: tournament.posts.map((post) => ({
        id: post.server.id,
        serverId: post.server.serverId,
        serverName: post.server.serverName,
        inviteLink: post.server.inviteLink,
      })),
    };
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


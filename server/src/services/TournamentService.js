import { prisma } from "../config/database.js";

export class TournamentService {
  async listTournaments() {
    try {
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
      return tournaments.map((tournament) => {
        try {
          return {
            ...tournament,
            registeredCount: tournament.registrations?.filter(
              (r) => r.status === "CONFIRMED" || r.status === "PENDING"
            ).length || 0,
            servers: (tournament.posts || []).map((post) => {
              if (!post || !post.server) {
                return null;
              }
              return {
                id: post.server.id,
                serverId: post.server.serverId,
                serverName: post.server.serverName || 'Unknown Server',
                inviteLink: post.server.inviteLink || null,
              };
            }).filter(server => server !== null),
          };
        } catch (transformError) {
          console.error(`[TOURNAMENT SERVICE] Error transforming tournament ${tournament.id}:`, transformError);
          // Return tournament with safe defaults
          return {
            ...tournament,
            registeredCount: 0,
            servers: [],
          };
        }
      });
    } catch (error) {
      console.error("[TOURNAMENT SERVICE] Error listing tournaments:", error);
      console.error("[TOURNAMENT SERVICE] Error stack:", error.stack);
      throw error;
    }
  }

  async getTournamentById(id) {
    try {
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
      try {
        return {
          ...tournament,
          registeredCount: tournament.registrations?.filter(
            (r) => r.status === "CONFIRMED" || r.status === "PENDING"
          ).length || 0,
          servers: (tournament.posts || []).map((post) => {
            if (!post || !post.server) {
              return null;
            }
            return {
              id: post.server.id,
              serverId: post.server.serverId,
              serverName: post.server.serverName || 'Unknown Server',
              inviteLink: post.server.inviteLink || null,
            };
          }).filter(server => server !== null),
        };
      } catch (transformError) {
        console.error(`[TOURNAMENT SERVICE] Error transforming tournament ${id}:`, transformError);
        // Return tournament with safe defaults
        return {
          ...tournament,
          registeredCount: 0,
          servers: [],
        };
      }
    } catch (error) {
      console.error(`[TOURNAMENT SERVICE] Error getting tournament ${id}:`, error);
      console.error("[TOURNAMENT SERVICE] Error stack:", error.stack);
      throw error;
    }
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


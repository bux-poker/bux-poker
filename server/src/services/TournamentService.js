import { prisma } from "../config/database.js";

export class TournamentService {
  async listTournaments() {
    try {
      // First, try to get tournaments with all relations
      let tournaments;
      try {
        tournaments = await prisma.tournament.findMany({
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
                server: true,
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
      } catch (queryError) {
        console.error("[TOURNAMENT SERVICE] Prisma query error:", queryError);
        // If the query fails (e.g., relation issues), try without posts
        tournaments = await prisma.tournament.findMany({
          orderBy: { startTime: "asc" },
          include: {
            registrations: {
              select: {
                id: true,
                userId: true,
                status: true,
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
        // Manually fetch posts for each tournament if needed
        for (const tournament of tournaments) {
          try {
            const posts = await prisma.tournamentPost.findMany({
              where: { tournamentId: tournament.id },
              include: { server: true },
            });
            tournament.posts = posts || [];
          } catch (postError) {
            console.warn(`[TOURNAMENT SERVICE] Error fetching posts for tournament ${tournament.id}:`, postError.message);
            tournament.posts = [];
          }
        }
      }

      // Transform to include registeredCount and server info
      return tournaments.map((tournament) => {
        try {
          const registrations = tournament.registrations || [];
          const posts = tournament.posts || [];
          
          const servers = posts
            .filter(post => post && post.server)
            .map((post) => ({
              id: post.server.id,
              serverId: post.server.serverId,
              serverName: post.server.serverName || 'Unknown Server',
              inviteLink: post.server.inviteLink || null,
            }));

          return {
            ...tournament,
            registeredCount: registrations.filter(
              (r) => r.status === "CONFIRMED" || r.status === "PENDING"
            ).length,
            servers: servers,
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
      console.error("[TOURNAMENT SERVICE] Error name:", error.name);
      console.error("[TOURNAMENT SERVICE] Error message:", error.message);
      console.error("[TOURNAMENT SERVICE] Error stack:", error.stack);
      // Return empty array instead of throwing to prevent 500
      return [];
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
              server: true,
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

      // Add registeredCount, server info, and parse blindLevels
      try {
        let blindLevels = [];
        try {
          blindLevels = JSON.parse(tournament.blindLevelsJson || '[]');
        } catch (e) {
          console.warn(`[TOURNAMENT SERVICE] Failed to parse blindLevels for tournament ${id}:`, e);
          blindLevels = [];
        }

        return {
          ...tournament,
          blindLevels: blindLevels, // Add parsed blind levels
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


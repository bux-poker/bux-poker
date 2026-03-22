import { prisma } from "../config/database.js";

/** All registered players appear; first eliminated (worst finishing place) near bottom. */
function mergeRegistrationsIntoStandings(livePlayers, registrations) {
  const seen = new Set(livePlayers.map((p) => p.userId));
  const out = [...livePlayers];
  for (const r of registrations || []) {
    if (r.status !== "CONFIRMED" && r.status !== "PENDING") continue;
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    out.push({
      id: `registration-${r.id}`,
      userId: r.userId,
      user: r.user,
      chips: 0,
      status: "REGISTERED",
      gameId: null,
      tableNumber: null,
      seatNumber: null,
      finishingPlace: null,
    });
  }
  return out;
}

function sortTournamentStandings(rows) {
  const registered = rows.filter((r) => r.status === "REGISTERED");
  const eliminated = rows.filter((r) => r.status === "ELIMINATED");
  const active = rows.filter(
    (r) => r.status !== "ELIMINATED" && r.status !== "REGISTERED"
  );
  active.sort((a, b) => (b.chips ?? 0) - (a.chips ?? 0));
  eliminated.sort(
    (a, b) => (a.finishingPlace ?? 999) - (b.finishingPlace ?? 999)
  );
  registered.sort((a, b) =>
    (a.user?.username || "").localeCompare(b.user?.username || "")
  );
  return [...active, ...eliminated, ...registered];
}

export class TournamentService {
  async listTournaments() {
    try {
      // First, try to get tournaments with all relations
      let tournaments;
      try {
        tournaments = await prisma.tournament.findMany({
          where: { leagueGames: { none: {} } },
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
          where: { leagueGames: { none: {} } },
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

  /**
   * Load tournament + games + players. If the single deep query fails (engine/timeout),
   * fall back to tournament row + separate games query so the lobby can still load.
   */
  async _fetchTournamentWithRelations(id) {
    const fullInclude = {
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
      games: {
        orderBy: { tableNumber: "asc" },
        include: {
          players: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  avatarUrl: true,
                },
              },
            },
          },
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
    };

    try {
      return await prisma.tournament.findUnique({
        where: { id },
        include: fullInclude,
      });
    } catch (primaryErr) {
      console.error(
        `[TOURNAMENT SERVICE] Primary findUnique failed for ${id}:`,
        primaryErr?.message || primaryErr
      );
      try {
        const base = await prisma.tournament.findUnique({
          where: { id },
          include: {
            registrations: fullInclude.registrations,
            posts: fullInclude.posts,
            createdBy: fullInclude.createdBy,
          },
        });
        if (!base) return null;
        const games = await prisma.game.findMany({
          where: { tournamentId: id },
          orderBy: { tableNumber: "asc" },
          include: {
            players: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        });
        return { ...base, games };
      } catch (fallbackErr) {
        console.error(
          `[TOURNAMENT SERVICE] Fallback fetch also failed for ${id}:`,
          fallbackErr?.message || fallbackErr
        );
        throw primaryErr;
      }
    }
  }

  async getTournamentById(id) {
    try {
      const tournament = await this._fetchTournamentWithRelations(id);

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

        // Calculate prize places dynamically: 1 place per 4 registered players
        const registeredCount = tournament.registrations?.filter(
          (r) => r.status === "CONFIRMED" || r.status === "PENDING"
        ).length || 0;
        const calculatedPrizePlaces = Math.floor(registeredCount / 4);

        // Flatten live players across all games so the lobby (and other
        // clients) can easily show current chip stacks / statuses without
        // re-deriving them from games on the client.
        //
        // For COMPLETED tournaments, always fetch players directly from DB
        // so we get correct chips and finishingPlace (games relation can miss closed tables).
        let livePlayers = [];
        let remainingPlayers = 0;

        if (tournament.status === "COMPLETED") {
          const directPlayers = await prisma.player.findMany({
            where: { game: { tournamentId: id } },
            include: { user: { select: { id: true, username: true, avatarUrl: true } } },
            orderBy: [{ finishingPlace: "asc" }, { chips: "desc" }],
          });
          for (const p of directPlayers) {
            if (p.status !== "ELIMINATED") remainingPlayers++;
            livePlayers.push({
              id: p.id,
              userId: p.userId,
              user: p.user,
              chips: p.chips,
              status: p.status,
              gameId: p.gameId,
              tableNumber: null,
              seatNumber: p.seatNumber,
              finishingPlace: p.finishingPlace ?? null,
            });
          }
        } else {
          for (const game of tournament.games || []) {
            for (const player of game.players || []) {
              if (player.status !== "ELIMINATED") remainingPlayers++;
              livePlayers.push({
                id: player.id,
                userId: player.userId,
                user: player.user,
                chips: player.chips,
                status: player.status,
                gameId: game.id,
                tableNumber: game.tableNumber,
                seatNumber: player.seatNumber,
                finishingPlace: player.finishingPlace ?? null,
              });
            }
          }
        }

        livePlayers = mergeRegistrationsIntoStandings(
          livePlayers,
          tournament.registrations
        );
        livePlayers = sortTournamentStandings(livePlayers);

        return {
          ...tournament,
          startedAt: tournament.startedAt, // Include startedAt for blind timer
          blindLevels: blindLevels, // Add parsed blind levels
          registeredCount: registeredCount,
          remainingPlayers: remainingPlayers, // Players still in tournament (not eliminated; includes all-in)
          prizePlaces: calculatedPrizePlaces, // Calculate dynamically based on registrations
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
          players: livePlayers,
        };
      } catch (transformError) {
        console.error(`[TOURNAMENT SERVICE] Error transforming tournament ${id}:`, transformError);
        // Return tournament with safe defaults
        return {
          ...tournament,
          registeredCount: 0,
          servers: [],
          players: [],
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
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new Error("Tournament not found");
    if (tournament.status !== "SCHEDULED" && tournament.status !== "REGISTERING") {
      throw new Error("Tournament is not open for registration");
    }
    if (tournament.registrationOpensAt && new Date(tournament.registrationOpensAt) > new Date()) {
      throw new Error("Registration is not open yet");
    }

    // Check if already registered first to avoid race conditions
    const existing = await prisma.tournamentRegistration.findUnique({
      where: {
        tournamentId_userId: { tournamentId, userId }
      }
    });

    if (existing) {
      // Return existing registration with CONFIRMED status
      if (existing.status !== "CONFIRMED") {
        return prisma.tournamentRegistration.update({
          where: { id: existing.id },
          data: { status: "CONFIRMED" }
        });
      }
      return existing;
    }

    // Create new registration
    try {
      return await prisma.tournamentRegistration.create({
        data: {
        tournamentId,
        userId,
        status: "CONFIRMED"
        }
      });
    } catch (error) {
      // Handle race condition where registration was created between check and create
      if (error.code === 'P2002' && error.meta?.target?.includes('tournamentId_userId')) {
        // Registration was created by another request, return it
        return prisma.tournamentRegistration.findUnique({
          where: {
            tournamentId_userId: { tournamentId, userId }
      }
    });
      }
      throw error;
    }
  }
}


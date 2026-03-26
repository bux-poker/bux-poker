import { Router } from "express";
import { TournamentService } from "../services/TournamentService.js";
import { authenticateToken } from "../middleware/auth.js";
import { getDiscordClient } from "../discord/bot.js";
import { prisma } from "../config/database.js";

const router = Router();
const service = new TournamentService();

router.get("/", async (req, res, next) => {
  try {
    const tournaments = await service.listTournaments();
    res.json(tournaments);
  } catch (err) {
    console.error("[TOURNAMENTS ROUTE] Error listing tournaments:", err);
    console.error("[TOURNAMENTS ROUTE] Error name:", err.name);
    console.error("[TOURNAMENTS ROUTE] Error message:", err.message);
    console.error("[TOURNAMENTS ROUTE] Error stack:", err.stack);
    // Return empty array with error message instead of 500
    res.json([]);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const tournament = await service.getTournamentById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }
    res.json(tournament);
  } catch (err) {
    console.error("[TOURNAMENTS ROUTE] Error getting tournament:", err);
    console.error("[TOURNAMENTS ROUTE] Error name:", err.name);
    console.error("[TOURNAMENTS ROUTE] Error message:", err.message);
    console.error("[TOURNAMENTS ROUTE] Error stack:", err.stack);
    next(err);
  }
});

router.post("/:id/register", async (req, res, next) => {
  try {
    // TODO: get userId from auth middleware/session
    const userId = req.user?.id || req.body.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const registration = await service.registerForTournament({
      tournamentId: req.params.id,
      userId
    });

    res.json(registration);
  } catch (err) {
    next(err);
  }
});

function tournamentServerPayload(server, isMember) {
  return {
    id: server.id,
    serverId: server.serverId,
    serverName: server.serverName,
    inviteLink: server.inviteLink ?? null,
    isMember,
  };
}

// Check Discord server membership for tournaments
router.get("/:id/server-membership", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  try {
    // Get user's Discord ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true },
    });

    if (!user || !user.discordId) {
      return res.json({ isMember: false, servers: [] });
    }

    // Get tournament with servers
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        posts: {
          include: {
            server: true,
          },
        },
      },
    });

    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    const posts = tournament.posts.filter((p) => p.server);
    if (posts.length === 0) {
      return res.json({ servers: [] });
    }

    const discordClient = getDiscordClient();
    const discordReady = discordClient?.isReady?.();

    if (!discordReady) {
      return res.json({
        servers: posts.map((p) => tournamentServerPayload(p.server, false)),
      });
    }

    const discordId = String(user.discordId);
    const serversWithMembership = [];

    for (const post of posts) {
      const server = post.server;
      let isMember = false;
      try {
        const guild = await discordClient.guilds.fetch(server.serverId).catch(() => null);
        if (guild) {
          const member = await guild.members.fetch(discordId).catch(() => null);
          isMember = !!member;
        }
      } catch (error) {
        console.warn(
          "[TOURNAMENTS] server-membership check failed",
          server.serverId,
          error?.message || error
        );
        isMember = false;
      }
      serversWithMembership.push(tournamentServerPayload(server, isMember));
    }

    return res.json({ servers: serversWithMembership });
  } catch (err) {
    console.error("[TOURNAMENTS] server-membership fatal:", err?.message || err);
    // Optional UI enrichment — never break the tournaments page
    return res.status(200).json({ servers: [] });
  }
});

// Get user's game/table for a tournament
router.get("/:id/my-table", authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Find player in tournament games
    const player = await prisma.player.findFirst({
      where: {
        userId: userId,
        game: {
          tournamentId: id,
        },
      },
      include: {
        game: {
          include: {
            tournament: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!player) {
      return res.status(404).json({ error: "You are not playing in this tournament" });
    }

    res.json({
      gameId: player.gameId,
      tableNumber: player.game.tableNumber,
      seatNumber: player.seatNumber,
      game: player.game,
    });
  } catch (err) {
    next(err);
  }
});

export default router;


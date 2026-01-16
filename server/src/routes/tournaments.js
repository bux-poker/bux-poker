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

// Check Discord server membership for tournaments
router.get("/:id/server-membership", authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

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

    const discordClient = getDiscordClient();
    if (!discordClient) {
      return res.json({ isMember: false, servers: tournament.posts.map(p => ({ ...p.server, isMember: false })) });
    }

    // Check membership for each server
    const serversWithMembership = await Promise.all(
      tournament.posts.map(async (post) => {
        const server = post.server;
        let isMember = false;

        try {
          const guild = await discordClient.guilds.fetch(server.serverId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch(user.discordId).catch(() => null);
            isMember = !!member;
          }
        } catch (error) {
          // User not in server
          isMember = false;
        }

        return {
          ...server,
          isMember,
        };
      })
    );

    res.json({ servers: serversWithMembership });
  } catch (err) {
    next(err);
  }
});

export default router;


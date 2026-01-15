import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdminRole } from "../middleware/admin.js";
import { TournamentEngine } from "../services/TournamentEngine.js";
import { prisma } from "../config/database.js";
import { postTournamentEmbed, getDiscordClient } from "../discord/bot.js";

const router = Router();
const engine = new TournamentEngine();

// All admin routes require JWT auth AND admin role
router.use(authenticateToken);
router.use(requireAdminRole);

// Check if current user is an admin
router.get("/check", async (req, res, next) => {
  try {
    // If we got here, user passed requireAdminRole middleware
    res.json({ isAdmin: true });
  } catch (err) {
    next(err);
  }
});

// Get all configured Discord servers
router.get("/servers", async (req, res, next) => {
  try {
    const discordClient = getDiscordClient();
    const servers = await prisma.discordServer.findMany({
      where: { enabled: true },
      orderBy: { serverName: "asc" },
    });

    // Enrich with current bot membership status
    const enrichedServers = await Promise.all(
      servers.map(async (server) => {
        let isBotMember = false;
        if (discordClient) {
          try {
            const guild = await discordClient.guilds.fetch(server.serverId);
            isBotMember = !!guild;
          } catch (error) {
            // Bot is not a member of this server
            isBotMember = false;
          }
        }
        return {
          ...server,
          isBotMember,
        };
      })
    );

    res.json(enrichedServers);
  } catch (err) {
    next(err);
  }
});

// Create a new tournament
router.post("/tournaments", async (req, res, next) => {
  try {
    const {
      name,
      description,
      startTime,
      maxPlayers = 100,
      seatsPerTable = 9,
      startingChips = 10000,
      blindLevelsJson,
      prizePlaces = 3,
      serverIds = [], // Array of Discord server IDs to post to
    } = req.body;

    if (!name || !startTime) {
      return res.status(400).json({ error: "Name and startTime are required" });
    }

    // Default blind levels if not provided
    const defaultBlindLevels = [
      { level: 1, smallBlind: 25, bigBlind: 50, duration: 15 },
      { level: 2, smallBlind: 50, bigBlind: 100, duration: 15 },
      { level: 3, smallBlind: 100, bigBlind: 200, duration: 15 },
      { level: 4, smallBlind: 200, bigBlind: 400, duration: 15 },
      { level: 5, smallBlind: 400, bigBlind: 800, duration: 15 },
    ];

    const blindLevels = blindLevelsJson
      ? typeof blindLevelsJson === "string"
        ? JSON.parse(blindLevelsJson)
        : blindLevelsJson
      : defaultBlindLevels;

    const tournament = await prisma.tournament.create({
      data: {
        name,
        description,
        startTime: new Date(startTime),
        maxPlayers,
        seatsPerTable,
        startingChips,
        blindLevelsJson: JSON.stringify(blindLevels),
        prizePlaces,
        createdById: req.userId, // From JWT auth middleware
      },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Post tournament embed to selected Discord servers
    if (serverIds && serverIds.length > 0) {
      try {
        await postTournamentEmbed(tournament, serverIds);
      } catch (error) {
        console.error("[ADMIN] Error posting tournament embed:", error);
        // Don't fail the tournament creation if embed posting fails
      }
    }

    res.status(201).json(tournament);
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/start", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await engine.startTournament(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/advance-blinds", async (req, res, next) => {
  try {
    const { id } = req.params;
    const games = await engine.advanceBlindLevel(id);
    res.json({ tournamentId: id, games });
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/end", async (req, res, next) => {
  try {
    const { id } = req.params;
    await engine.advanceBlindLevel(id); // optional last blind bump
    await prisma.tournament.update({
      where: { id },
      data: { status: "COMPLETED" }
    });
    res.json({ tournamentId: id, status: "COMPLETED" });
  } catch (err) {
    next(err);
  }
});

export default router;


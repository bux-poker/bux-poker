import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdminRole } from "../middleware/admin.js";
import { TournamentEngine } from "../services/TournamentEngine.js";
import { prisma } from "../config/database.js";
import { postTournamentEmbed, getDiscordClient } from "../discord/bot.js";

const router = Router();
const engine = new TournamentEngine();

// Check if current user is an admin (accessible without admin role to check status)
router.get("/check", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.json({ isAdmin: false });
    }

    // Get user with Discord ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, discordId: true },
    });

    if (!user || !user.discordId) {
      return res.json({ isAdmin: false });
    }

    // Get all configured Discord servers with admin roles
    const servers = await prisma.discordServer.findMany({
      where: {
        enabled: true,
        setupCompleted: true,
        adminRoleId: { not: null },
      },
      select: {
        serverId: true,
        adminRoleId: true,
        serverName: true,
      },
    });

    if (servers.length === 0) {
      // No servers configured yet - allow access for initial setup
      return res.json({ isAdmin: true });
    }

    // Check if user has admin role in any server
    const discordClient = getDiscordClient();
    if (!discordClient) {
      // Bot not available - deny for security
      return res.json({ isAdmin: false });
    }

    // Check each server
    for (const server of servers) {
      try {
        const guild = await discordClient.guilds.fetch(server.serverId).catch(() => null);
        if (!guild) continue;

        const member = await guild.members.fetch(user.discordId).catch(() => null);
        if (!member) continue;

        if (member.roles.cache.has(server.adminRoleId)) {
          // User has admin role in this server
          return res.json({ isAdmin: true });
        }
      } catch (error) {
        // Continue checking other servers
        continue;
      }
    }

    // User doesn't have admin role in any server
    res.json({ isAdmin: false });
  } catch (err) {
    console.error("[ADMIN CHECK] Error:", err);
    res.json({ isAdmin: false });
  }
});

// All other admin routes require JWT auth AND admin role
router.use(authenticateToken);
router.use(requireAdminRole);

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

// Cancel tournament
router.patch("/tournaments/:id/cancel", async (req, res, next) => {
  try {
    const { id } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    if (tournament.status === "COMPLETED" || tournament.status === "CANCELLED") {
      return res.status(400).json({ error: "Cannot cancel a completed or already cancelled tournament" });
    }

    // Update tournament status
    await prisma.tournament.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    res.json({ tournamentId: id, status: "CANCELLED" });
  } catch (err) {
    next(err);
  }
});

// Get tournament data for duplication (returns data to pre-fill create form)
router.get("/tournaments/:id/duplicate", async (req, res, next) => {
  try {
    const { id } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    // Parse blind levels
    let blindLevels = [];
    try {
      blindLevels = JSON.parse(tournament.blindLevelsJson || '[]');
    } catch (e) {
      blindLevels = [];
    }

    // Return tournament data for pre-filling form
    res.json({
      name: `${tournament.name} (Copy)`,
      description: tournament.description || '',
      maxPlayers: tournament.maxPlayers,
      seatsPerTable: tournament.seatsPerTable,
      startingChips: tournament.startingChips,
      prizePlaces: tournament.prizePlaces,
      blindLevels: blindLevels,
    });
  } catch (err) {
    next(err);
  }
});

export default router;


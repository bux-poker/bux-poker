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
      { level: 1, smallBlind: 25, bigBlind: 50, duration: 10 },
      { level: 2, smallBlind: 50, bigBlind: 100, duration: 10 },
      { level: 3, smallBlind: 100, bigBlind: 200, duration: 10 },
      { level: 4, smallBlind: 150, bigBlind: 300, duration: 10 },
      { level: 5, smallBlind: 200, bigBlind: 400, duration: 10 },
      { level: 6, smallBlind: 250, bigBlind: 500, duration: 10, breakAfter: 5 },
      { level: 7, smallBlind: 300, bigBlind: 600, duration: 10 },
      { level: 8, smallBlind: 400, bigBlind: 800, duration: 10 },
      { level: 9, smallBlind: 500, bigBlind: 1000, duration: 10 },
      { level: 10, smallBlind: 600, bigBlind: 1200, duration: 10 },
      { level: 11, smallBlind: 750, bigBlind: 1500, duration: 10 },
      { level: 12, smallBlind: 1000, bigBlind: 2000, duration: 10, breakAfter: 5 },
      { level: 13, smallBlind: 1250, bigBlind: 2500, duration: 10 },
      { level: 14, smallBlind: 1500, bigBlind: 3000, duration: 10 },
      { level: 15, smallBlind: 2000, bigBlind: 4000, duration: 10 },
      { level: 16, smallBlind: 2500, bigBlind: 5000, duration: 10 },
      { level: 17, smallBlind: 3000, bigBlind: 6000, duration: 10 },
      { level: 18, smallBlind: 4000, bigBlind: 8000, duration: 10, breakAfter: 5 },
      { level: 19, smallBlind: 5000, bigBlind: 10000, duration: null }, // Infinite
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

    // Create TournamentPost entries immediately for selected servers (even if posting fails)
    if (serverIds && serverIds.length > 0) {
      try {
        // Find Discord servers by serverId
        const discordServers = await prisma.discordServer.findMany({
          where: {
            serverId: { in: serverIds },
            enabled: true,
            setupCompleted: true,
          },
        });

        // Create post entries for each server (messageId will be null until post succeeds)
        await Promise.all(
          discordServers.map((server) =>
            prisma.tournamentPost.upsert({
              where: {
                tournamentId_serverId: {
                  tournamentId: tournament.id,
                  serverId: server.id,
                },
              },
              update: {}, // No update needed if exists
              create: {
                tournamentId: tournament.id,
                serverId: server.id,
                messageId: null, // Will be set when embed is successfully posted
                postedAt: null,
              },
            })
          )
        );

        console.log(`[ADMIN] Created TournamentPost entries for ${discordServers.length} server(s)`);
      } catch (error) {
        console.error("[ADMIN] Error creating tournament post entries:", error);
        // Continue even if post creation fails
      }

      // Now attempt to post tournament embed to Discord
      try {
        await postTournamentEmbed(tournament, serverIds);
      } catch (error) {
        console.error("[ADMIN] Error posting tournament embed:", error);
        // Don't fail the tournament creation if embed posting fails
        // Posts are already created, so servers will still show
      }
    }

    // Fetch tournament with posts to include in response
    const tournamentWithPosts = await prisma.tournament.findUnique({
      where: { id: tournament.id },
      include: {
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

    res.status(201).json(tournamentWithPosts);
  } catch (err) {
    next(err);
  }
});

// Close registration: seat players but don't start
router.post("/tournaments/:id/close-registration", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await engine.closeRegistration(id);
    res.json(result);
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

// Delete tournament (permanently removes from database)
router.delete("/tournaments/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    // Manually delete related records first (some don't have cascade delete set)
    // Delete in order to respect foreign key constraints
    
    // 1. Delete players (and their related records)
    const games = await prisma.game.findMany({
      where: { tournamentId: id },
      include: { players: true },
    });
    
    for (const game of games) {
      // Delete players in each game
      await prisma.player.deleteMany({
        where: { gameId: game.id },
      });
    }
    
    // 2. Delete games
    await prisma.game.deleteMany({
      where: { tournamentId: id },
    });
    
    // 3. Delete registrations
    await prisma.tournamentRegistration.deleteMany({
      where: { tournamentId: id },
    });
    
    // 4. Delete posts (has cascade, but being explicit)
    await prisma.tournamentPost.deleteMany({
      where: { tournamentId: id },
    });
    
    // 5. Finally, delete the tournament itself
    await prisma.tournament.delete({
      where: { id },
    });

    res.json({ tournamentId: id, deleted: true });
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

// Add test/dummy players to a tournament for testing
router.post("/tournaments/:id/add-test-players", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { count = 9 } = req.body; // Default to 9 players (one full table)

    // Validate count
    const playerCount = Math.max(1, Math.min(Number(count), 100)); // Clamp between 1-100

    // Get tournament
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        registrations: true,
      },
    });

    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    // Check tournament status
    if (tournament.status === "RUNNING" || tournament.status === "COMPLETED" || tournament.status === "CANCELLED") {
      return res.status(400).json({ 
        error: "Cannot add test players to a running, completed, or cancelled tournament" 
      });
    }

    // Check if we have space for new players
    const currentRegistrations = tournament.registrations.length;
    const availableSlots = tournament.maxPlayers - currentRegistrations;

    if (availableSlots <= 0) {
      return res.status(400).json({ 
        error: `Tournament is full (${tournament.maxPlayers}/${tournament.maxPlayers} players)` 
      });
    }

    const playersToAdd = Math.min(playerCount, availableSlots);
    const createdRegistrations = [];

    // Create test players and register them
    for (let i = 1; i <= playersToAdd; i++) {
      // Create or find test user
      const testUsername = `Test Player ${i}`;
      const testEmail = `testplayer${i}@test.buxpoker.local`; // Local domain for test accounts

      let testUser = await prisma.user.findUnique({
        where: { email: testEmail },
      });

      // Create user if doesn't exist
      if (!testUser) {
        testUser = await prisma.user.create({
          data: {
            username: testUsername,
            email: testEmail,
            // No discordId for test accounts
          },
        });
      }

      // Check if already registered
      const existingRegistration = await prisma.tournamentRegistration.findUnique({
        where: {
          tournamentId_userId: {
            tournamentId: tournament.id,
            userId: testUser.id,
          },
        },
      });

      if (existingRegistration) {
        // Update to CONFIRMED if exists but not confirmed
        if (existingRegistration.status !== "CONFIRMED") {
          await prisma.tournamentRegistration.update({
            where: { id: existingRegistration.id },
            data: { status: "CONFIRMED" },
          });
        }
        createdRegistrations.push(existingRegistration);
      } else {
        // Create new registration with CONFIRMED status (ready to play)
        const registration = await prisma.tournamentRegistration.create({
          data: {
            tournamentId: tournament.id,
            userId: testUser.id,
            status: "CONFIRMED",
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        });
        createdRegistrations.push(registration);
      }
    }

    // Update tournament status to REGISTERING if it was SCHEDULED
    if (tournament.status === "SCHEDULED") {
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: { status: "REGISTERING" },
      });
    }

    res.json({
      message: `Successfully added ${createdRegistrations.length} test player(s)`,
      playersAdded: createdRegistrations.length,
      totalRegistrations: currentRegistrations + createdRegistrations.length,
      registrations: createdRegistrations,
    });
  } catch (err) {
    next(err);
  }
});

export default router;


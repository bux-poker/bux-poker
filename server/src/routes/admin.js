import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdminRole } from "../middleware/admin.js";
import { computeWebIsAdmin } from "../utils/webAdminStatus.js";
import { TournamentEngine } from "../services/TournamentEngine.js";
import { prisma } from "../config/database.js";
import { postTournamentEmbed } from "../discord/bot.js";

const router = Router();
const engine = new TournamentEngine();

const DISCORD_API_V10 = "https://discord.com/api/v10";

/**
 * Whether the bot is in the guild — Discord REST only (GET /guilds/:id).
 * Does not depend on the gateway client or ClientReady, so /admin is not blocked on WebSocket startup.
 * @returns {Promise<{ ok: boolean | null, reason?: string }>}
 *   ok true = in guild, false = not in guild, null = could not determine (reason explains why).
 */
async function resolveBotGuildMembership(rawServerId) {
  const raw = process.env.DISCORD_BOT_TOKEN;
  const token = raw ? String(raw).replace(/^(Bot|Bearer)\s*/i, "") : "";
  const id = String(rawServerId ?? "").trim();
  if (!token) return { ok: null, reason: "no_bot_token" };
  if (!/^\d{17,20}$/.test(id)) {
    console.warn("[ADMIN /servers] Invalid Discord guild id:", rawServerId);
    return { ok: false };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${DISCORD_API_V10}/guilds/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { Authorization: `Bot ${token}` },
      });
      if (res.ok) return { ok: true };
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 10004) return { ok: false };
        return { ok: false };
      }
      if (res.status === 401) {
        console.warn("[ADMIN /servers] Discord REST 401 — invalid or missing DISCORD_BOT_TOKEN");
        return { ok: null, reason: "discord_unauthorized" };
      }
      if (res.status === 403) {
        return { ok: false };
      }
      if (res.status === 429 && attempt === 0) {
        const ra = res.headers.get("retry-after");
        const sec = ra ? Number(ra) : 1;
        await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(sec) ? sec * 1000 : 1000, 5000)));
        continue;
      }
      if (res.status === 429) {
        return { ok: null, reason: "discord_rate_limited" };
      }
      console.warn("[ADMIN /servers] Discord REST guild lookup HTTP", res.status, id);
      return { ok: null, reason: `discord_http_${res.status}` };
    } catch (e) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }
      console.warn("[ADMIN /servers] Discord REST guild lookup error", id, e?.message || e);
      return { ok: null, reason: "network_error" };
    }
  }
  return { ok: null, reason: "unknown" };
}

/** Deep delete tournament (same as DELETE /api/admin/tournaments/:id). */
async function deleteTournamentCascade(tournamentId) {
  const games = await prisma.game.findMany({
    where: { tournamentId },
    include: { players: true },
  });
  for (const game of games) {
    await prisma.player.deleteMany({ where: { gameId: game.id } });
  }
  await prisma.game.deleteMany({ where: { tournamentId } });
  await prisma.tournamentRegistration.deleteMany({ where: { tournamentId } });
  await prisma.tournamentPost.deleteMany({ where: { tournamentId } });
  await prisma.tournament.delete({ where: { id: tournamentId } });
}

/** Admin UI: cancel allowed before any leg is seated, running, or completed. */
function computeLeagueAdminFlags(league) {
  const statuses = league.games.map((g) => g.tournament.status);
  const hasBlocking = statuses.some((s) => s === "SEATED" || s === "RUNNING");
  const hasPlayStarted = statuses.some(
    (s) => s === "SEATED" || s === "RUNNING" || s === "COMPLETED"
  );
  const canCancel =
    (league.status === "PLANNED" || league.status === "ACTIVE") && !hasPlayStarted;
  const canDelete = !hasBlocking;
  return { canCancel, canDelete };
}

// Check if current user is an admin (accessible without admin role to check status)
router.get("/check", authenticateToken, async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");

    const userId = req.userId;
    if (!userId) {
      return res.json({ isAdmin: false });
    }

    // Get user with Discord ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, discordId: true },
    });

    if (!user) {
      return res.json({ isAdmin: false });
    }

    const isAdmin = await computeWebIsAdmin({ userId: user.id, discordId: user.discordId });
    return res.json({ isAdmin });
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
    res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");

    const servers = await prisma.discordServer.findMany({
      where: { enabled: true },
      orderBy: { serverName: "asc" },
    });

    const enrichedServers = await Promise.all(
      servers.map(async (server) => {
        const { ok, reason } = await resolveBotGuildMembership(server.serverId);
        return {
          ...server,
          isBotMember: ok,
          ...(ok === null && reason ? { botMembershipReason: reason } : {}),
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
      serverIds = [], // Array of Discord server IDs to post to
    } = req.body;

    // Calculate prize places: 1 place per 4 registered players
    // Initially set to 0 since no one is registered yet
    // Will be calculated dynamically when registration closes based on actual registrations
    const prizePlaces = 0;

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

// List leagues for admin UI (includes cancelled; flags for cancel/delete)
router.get("/leagues", async (req, res, next) => {
  try {
    const leagues = await prisma.league.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
      include: {
        games: {
          orderBy: { gameNumber: "asc" },
          include: {
            tournament: { select: { id: true, status: true, startTime: true } },
          },
        },
      },
    });
    const result = leagues.map((L) => {
      const flags = computeLeagueAdminFlags(L);
      return {
        id: L.id,
        name: L.name,
        description: L.description,
        totalGames: L.totalGames,
        status: L.status,
        month: L.month,
        year: L.year,
        canCancel: flags.canCancel,
        canDelete: flags.canDelete,
      };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Create a league: N tournaments (legs) with per-game start times; Discord posts at T-1h via poll
router.post("/leagues", async (req, res, next) => {
  try {
    const {
      name,
      description,
      timezone,
      gameStartTimes,
      maxPlayers = 100,
      seatsPerTable = 9,
      startingChips = 10000,
      blindLevelsJson,
      serverIds = [],
    } = req.body;

    if (!name || !Array.isArray(gameStartTimes) || gameStartTimes.length < 1) {
      return res
        .status(400)
        .json({ error: "name and gameStartTimes (non-empty array) are required" });
    }

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
      { level: 19, smallBlind: 5000, bigBlind: 10000, duration: null },
    ];

    const blindLevels = blindLevelsJson
      ? typeof blindLevelsJson === "string"
        ? JSON.parse(blindLevelsJson)
        : blindLevelsJson
      : defaultBlindLevels;

    const starts = gameStartTimes.map((s) => new Date(s));
    for (const st of starts) {
      if (Number.isNaN(st.getTime())) {
        return res.status(400).json({ error: "Invalid game start time in gameStartTimes" });
      }
    }

    const totalGames = starts.length;
    const d0 = starts[0];

    const league = await prisma.league.create({
      data: {
        name,
        description: description || null,
        timezone: timezone || null,
        month: d0.getUTCMonth() + 1,
        year: d0.getUTCFullYear(),
        totalGames,
        status: "ACTIVE",
        createdById: req.userId,
      },
    });

    const discordServers =
      serverIds.length > 0
        ? await prisma.discordServer.findMany({
            where: {
              serverId: { in: serverIds },
              enabled: true,
              setupCompleted: true,
            },
          })
        : [];

    const ONE_H = 60 * 60 * 1000;

    for (let i = 0; i < starts.length; i++) {
      const startTime = starts[i];
      const registrationOpensAt = new Date(startTime.getTime() - ONE_H);

      const tournament = await prisma.tournament.create({
        data: {
          name: `${name} — Game ${i + 1}/${totalGames}`,
          description:
            description ||
            `${name} — League game ${i + 1} of ${totalGames}`,
          startTime,
          maxPlayers,
          seatsPerTable,
          startingChips,
          blindLevelsJson: JSON.stringify(blindLevels),
          prizePlaces: 0,
          registrationOpensAt,
          createdById: req.userId,
        },
      });

      await prisma.leagueGame.create({
        data: {
          leagueId: league.id,
          tournamentId: tournament.id,
          gameNumber: i + 1,
        },
      });

      for (const server of discordServers) {
        await prisma.tournamentPost.upsert({
          where: {
            tournamentId_serverId: {
              tournamentId: tournament.id,
              serverId: server.id,
            },
          },
          update: {},
          create: {
            tournamentId: tournament.id,
            serverId: server.id,
            messageId: null,
            postedAt: null,
          },
        });
      }
    }

    const full = await prisma.league.findUnique({
      where: { id: league.id },
      include: {
        games: {
          orderBy: { gameNumber: "asc" },
          include: {
            tournament: {
              select: {
                id: true,
                name: true,
                startTime: true,
                status: true,
                registrationOpensAt: true,
              },
            },
          },
        },
      },
    });

    res.status(201).json(full);
  } catch (err) {
    next(err);
  }
});

// Cancel league (only before any leg has started: no seated/running/completed legs)
router.patch("/leagues/:id/cancel", async (req, res, next) => {
  try {
    const { id } = req.params;
    const league = await prisma.league.findUnique({
      where: { id },
      include: {
        games: {
          include: {
            tournament: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!league) {
      return res.status(404).json({ error: "League not found" });
    }
    const { canCancel } = computeLeagueAdminFlags(league);
    if (!canCancel) {
      return res.status(400).json({
        error:
          "League cannot be cancelled once a leg has started or finished. Delete may still be available if no leg is running.",
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const g of league.games) {
        const st = g.tournament.status;
        if (st === "COMPLETED" || st === "CANCELLED") continue;
        await tx.tournament.update({
          where: { id: g.tournament.id },
          data: { status: "CANCELLED" },
        });
      }
      await tx.league.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    });

    res.json({ leagueId: id, status: "CANCELLED" });
  } catch (err) {
    next(err);
  }
});

// Permanently delete league and all leg tournaments (blocked while any leg is SEATED or RUNNING)
router.delete("/leagues/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const league = await prisma.league.findUnique({
      where: { id },
      include: {
        games: {
          include: {
            tournament: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!league) {
      return res.status(404).json({ error: "League not found" });
    }
    const { canDelete } = computeLeagueAdminFlags(league);
    if (!canDelete) {
      return res.status(400).json({
        error:
          "Cannot delete league while a leg tournament is seated or running. Cancel or finish that leg first.",
      });
    }

    for (const g of league.games) {
      await deleteTournamentCascade(g.tournament.id);
    }
    await prisma.leagueStanding.deleteMany({ where: { leagueId: id } });
    await prisma.league.delete({ where: { id } });

    res.json({ leagueId: id, deleted: true });
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

    await deleteTournamentCascade(id);

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
    // Prize places are calculated automatically (1 per 4 registered players), so we don't include it
    res.json({
      name: `${tournament.name} (Copy)`,
      description: tournament.description || '',
      maxPlayers: tournament.maxPlayers,
      seatsPerTable: tournament.seatsPerTable,
      startingChips: tournament.startingChips,
      // prizePlaces removed - calculated automatically when registration closes
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


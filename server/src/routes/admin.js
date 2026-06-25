import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdminRole } from "../middleware/admin.js";
import {
  requireLeagueAdmin,
  requireTournamentAdmin,
} from "../middleware/tournamentAdmin.js";
import { computeWebIsAdmin } from "../utils/webAdminStatus.js";
import {
  assertUserMayUseServerIds,
  canManageLeague,
  getUserManagedDiscordServers,
} from "../utils/tournamentAdminAccess.js";
import { TournamentEngine } from "../services/TournamentEngine.js";
import { prisma } from "../config/database.js";
import { postTournamentEmbed, getDiscordClient } from "../discord/bot.js";
import {
  attachPrizeFundingSummary,
  buildPrizeFieldsFromRequest,
} from "../services/prizes/prizeCreateHelpers.js";
import { buildPrizeWalletRecordFromSupplied } from "../services/prizes/prizeWallet.js";

const router = Router();
const engine = new TournamentEngine();
const DISCORD_API_V10 = "https://discord.com/api/v10";

async function resolveBotGuildMembershipViaRest(rawServerId) {
  const raw = process.env.DISCORD_BOT_TOKEN;
  const token = raw ? String(raw).replace(/^(Bot|Bearer)\s*/i, "") : "";
  const id = String(rawServerId ?? "").trim();
  if (!token || !/^\d{17,20}$/.test(id)) return null;
  try {
    const res = await fetch(`${DISCORD_API_V10}/guilds/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.ok) return true;
    if (res.status === 404) return false;
    if (res.status === 401) {
      console.warn("[ADMIN /servers] Discord REST 401 — invalid DISCORD_BOT_TOKEN");
      return null;
    }
    return null;
  } catch (e) {
    console.warn("[ADMIN /servers] Discord REST guild check failed:", e?.message || e);
    return null;
  }
}

async function resolveBotGuildMembershipViaChannelRest(rawChannelId) {
  const raw = process.env.DISCORD_BOT_TOKEN;
  const token = raw ? String(raw).replace(/^(Bot|Bearer)\s*/i, "") : "";
  const channelId = String(rawChannelId ?? "").trim();
  if (!token || !/^\d{17,20}$/.test(channelId)) return null;
  try {
    const res = await fetch(`${DISCORD_API_V10}/channels/${encodeURIComponent(channelId)}`, {
      method: "GET",
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data?.guild_id ? true : null;
    }
    if (res.status === 404) return false;
    if (res.status === 401) {
      console.warn("[ADMIN /servers] Discord REST 401 (channel check) — invalid DISCORD_BOT_TOKEN");
      return null;
    }
    return null;
  } catch (e) {
    console.warn("[ADMIN /servers] Discord REST channel check failed:", e?.message || e);
    return null;
  }
}

/**
 * Whether the bot is in the guild. Cache-first, then REST fetch.
 * @returns {Promise<boolean|null>} true = in guild, false = not in guild, null = Discord unavailable or transient error
 */
async function resolveBotGuildMembership(discordClient, rawServerId) {
  const rest = await resolveBotGuildMembershipViaRest(rawServerId);
  if (rest === true || rest === false) return rest;

  if (!discordClient) return null;
  const id = String(rawServerId ?? "").trim();
  if (!/^\d{17,20}$/.test(id)) {
    console.warn("[ADMIN /servers] Invalid Discord guild id:", rawServerId);
    return false;
  }
  if (discordClient.guilds.cache.get(id)) return true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const guild = await discordClient.guilds.fetch(id);
      return !!guild;
    } catch (e) {
      const code = e?.code;
      // Only 10004 means the bot is definitively not in this guild (or ID is wrong).
      // Other errors (network, rate limit) must not become "bot not in server".
      if (code === 10004) return false;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }
      console.warn("[ADMIN /servers] guilds.fetch failed for", id, e?.message || e);
      return null;
    }
  }
  return null;
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
    res.setHeader("Expires", "0");
    const discordClient = getDiscordClient();
    const servers = await prisma.discordServer.findMany({
      where: { enabled: true },
      orderBy: { serverName: "asc" },
    });

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, discordId: true },
    });
    const managed = user
      ? await getUserManagedDiscordServers({
          userId: user.id,
          discordId: user.discordId,
        })
      : { servers: [] };

    const visibleServers =
      managed.allowlist || managed.bootstrap
        ? servers
        : servers.filter((s) =>
            managed.servers.some((m) => m.serverId === s.serverId)
          );

    // Enrich with bot membership: cache hit, else REST; unknown guild => false, transient errors => null
    const enrichedServers = await Promise.all(
      visibleServers.map(async (server) => {
        // HARD UNBLOCK:
        // At this point, Discord login is flaky and all REST/gateway checks can
        // still return null/false even when the bot is correctly invited.
        // For any configured server (enabled + setupCompleted + channel set),
        // always report isBotMember=true so the admin UI is never blocked.
        let isBotMember = true;
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
      serverIds = [], // Array of Discord server IDs to post to
      prizePlaces,
      prizeMode,
      prizeStructure,
      refundWalletAddress,
      prizeClaimServerId,
    } = req.body;

    if (!name || !startTime) {
      return res.status(400).json({ error: "Name and startTime are required" });
    }

    const creator = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, discordId: true },
    });
    try {
      await assertUserMayUseServerIds({
        userId: creator?.id,
        discordId: creator?.discordId,
        serverIds,
      });
    } catch (accessErr) {
      if (accessErr.status) {
        return res.status(accessErr.status).json({ error: accessErr.message });
      }
      throw accessErr;
    }

    let prizeFields;
    try {
      prizeFields = await buildPrizeFieldsFromRequest(req.body, {
        maxPlayers,
        requirePrizes: true,
      });
    } catch (prizeErr) {
      if (prizeErr.status) {
        return res.status(prizeErr.status).json({ error: prizeErr.message });
      }
      throw prizeErr;
    }
    const { prizeFundingSummary, ...prizeDbFields } = prizeFields;

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
        ...prizeDbFields,
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

    res.status(201).json(
      attachPrizeFundingSummary({
        ...tournamentWithPosts,
        prizeFundingSummary,
      })
    );
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
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, discordId: true },
    });

    const result = await Promise.all(
      leagues.map(async (L) => {
        const flags = computeLeagueAdminFlags(L);
        const canManage = user
          ? await canManageLeague({
              userId: user.id,
              discordId: user.discordId,
              leagueId: L.id,
            })
          : false;
        return {
          id: L.id,
          name: L.name,
          description: L.description,
          totalGames: L.totalGames,
          status: L.status,
          month: L.month,
          year: L.year,
          canCancel: flags.canCancel && canManage,
          canDelete: flags.canDelete && canManage,
          canManage,
        };
      })
    );
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

    const creator = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, discordId: true },
    });
    try {
      await assertUserMayUseServerIds({
        userId: creator?.id,
        discordId: creator?.discordId,
        serverIds,
      });
    } catch (accessErr) {
      if (accessErr.status) {
        return res.status(accessErr.status).json({ error: accessErr.message });
      }
      throw accessErr;
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

    let leaguePrizeFields;
    try {
      leaguePrizeFields = await buildPrizeFieldsFromRequest(req.body, {
        maxPlayers,
        requirePrizes: true,
      });
    } catch (prizeErr) {
      if (prizeErr.status) {
        return res.status(prizeErr.status).json({ error: prizeErr.message });
      }
      throw prizeErr;
    }
    const { prizeFundingSummary, hasPrizes: _hp, ...leaguePrizeDb } = leaguePrizeFields;

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
        ...leaguePrizeDb,
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
          hasPrizes: false,
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

    res.status(201).json(
      attachPrizeFundingSummary({
        ...full,
        prizeFundingSummary,
      })
    );
  } catch (err) {
    next(err);
  }
});

// Cancel league (only before any leg has started: no seated/running/completed legs)
router.patch("/leagues/:id/cancel", requireLeagueAdmin(), async (req, res, next) => {
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
router.delete("/leagues/:id", requireLeagueAdmin(), async (req, res, next) => {
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

async function applySuppliedPrizeWallet(prismaModel, id, body) {
  const { prizeWalletAddress, prizeWalletPrivateKey } = body ?? {};
  const row = await prisma[prismaModel].findUnique({ where: { id } });
  if (!row) {
    const err = new Error(
      prismaModel === "league" ? "League not found" : "Tournament not found"
    );
    err.status = 404;
    throw err;
  }
  if (row.prizeMode !== "WALLET") {
    const err = new Error("This event does not use wallet prize mode");
    err.status = 400;
    throw err;
  }
  const wallet = buildPrizeWalletRecordFromSupplied({
    prizeWalletAddress,
    privateKey: prizeWalletPrivateKey,
  });
  return prisma[prismaModel].update({
    where: { id },
    data: {
      prizeWalletAddress: wallet.prizeWalletAddress,
      prizeWalletSecretEnc: wallet.prizeWalletSecretEnc,
      prizeFundingStatus:
        row.prizeFundingStatus === "FUNDED" ? "FUNDED" : "PENDING",
    },
  });
}

router.post("/tournaments/:id/prize-wallet", requireTournamentAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await applySuppliedPrizeWallet("tournament", id, req.body);
    res.json(attachPrizeFundingSummary(updated));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post("/leagues/:id/prize-wallet", requireLeagueAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await applySuppliedPrizeWallet("league", id, req.body);
    res.json(attachPrizeFundingSummary(updated));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Close registration: seat players but don't start
router.post("/tournaments/:id/close-registration", requireTournamentAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await engine.closeRegistration(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/start", requireTournamentAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await engine.startTournament(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/advance-blinds", requireTournamentAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const games = await engine.advanceBlindLevel(id);
    res.json({ tournamentId: id, games });
  } catch (err) {
    next(err);
  }
});

router.post("/tournaments/:id/end", requireTournamentAdmin(), async (req, res, next) => {
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
router.patch("/tournaments/:id/cancel", requireTournamentAdmin(), async (req, res, next) => {
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
router.delete("/tournaments/:id", requireTournamentAdmin(), async (req, res, next) => {
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
router.get("/tournaments/:id/duplicate", requireTournamentAdmin(), async (req, res, next) => {
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
router.post("/tournaments/:id/add-test-players", requireTournamentAdmin(), async (req, res, next) => {
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
        // Create new registration with CONFIRMED status (ready to play).
        // Handle race if another request registers the same user concurrently.
        try {
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
        } catch (error) {
          const target = error?.meta?.target;
          const targetText = Array.isArray(target) ? target.join(",") : String(target || "");
          const isTournamentUserUnique =
            error?.code === "P2002" &&
            (targetText.includes("tournamentId_userId") ||
              (targetText.includes("tournamentId") && targetText.includes("userId")));

          if (!isTournamentUserUnique) throw error;

          const existingAfterRace = await prisma.tournamentRegistration.findUnique({
            where: {
              tournamentId_userId: {
                tournamentId: tournament.id,
                userId: testUser.id,
              },
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
          if (existingAfterRace) createdRegistrations.push(existingAfterRace);
        }
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


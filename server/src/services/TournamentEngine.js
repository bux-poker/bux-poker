import { prisma } from "../config/database.js";

// TournamentEngine: manages tables, seating, and basic progression.
// This is intentionally simplified but provides real table assignment
// and consolidation hooks.

/**
 * Compute current blind level index from tournament start time and blind level durations.
 * Returns { currentLevelIndex, blindLevels } or null if tournament/blinds invalid.
 */
export function getTournamentBlindLevelFromTime(tournament) {
  if (!tournament?.startedAt) return null;
  let blindLevels = [];
  try {
    blindLevels = tournament.blindLevelsJson ? JSON.parse(tournament.blindLevelsJson) : [];
  } catch (e) {
    return null;
  }
  if (blindLevels.length === 0) return null;
  const startedAt = new Date(tournament.startedAt);
  const elapsedMs = Date.now() - startedAt.getTime();
  let elapsedMinutes = elapsedMs / 1000 / 60;
  let currentLevelIndex = 0;
  for (let i = 0; i < blindLevels.length; i++) {
    const level = blindLevels[i];
    if (level.duration == null) {
      currentLevelIndex = i;
      break;
    }
    if (elapsedMinutes <= level.duration) {
      currentLevelIndex = i;
      break;
    }
    elapsedMinutes -= level.duration;
    if (level.breakAfter) elapsedMinutes -= level.breakAfter;
  }
  return { currentLevelIndex, blindLevels };
}

/**
 * Sync all ACTIVE games in a RUNNING tournament to the same blind level (from tournament elapsed time).
 * Call after consolidation so all tables resume with the same blinds; also used by blind timer.
 * Optionally emits dealer message to each table.
 */
export async function syncBlindLevelsToTournamentTime(tournamentId, io, options = { emitDealerMessage: true }) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId }
  });
  if (!tournament || tournament.status !== "RUNNING" || !tournament.startedAt) return null;
  const result = getTournamentBlindLevelFromTime(tournament);
  if (!result) return null;
  const { currentLevelIndex, blindLevels } = result;
  const newLevel = blindLevels[currentLevelIndex];
  if (!newLevel) return null;

  const games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    select: { id: true, tableNumber: true, currentBlindLevel: true }
  });
  if (games.length === 0) return null;

  const updateData = {
    currentBlindLevel: currentLevelIndex,
    ...(newLevel.smallBlind != null && { smallBlind: newLevel.smallBlind }),
    ...(newLevel.bigBlind != null && { bigBlind: newLevel.bigBlind })
  };

  for (const game of games) {
    await prisma.game.update({
      where: { id: game.id },
      data: updateData
    }).catch((err) => {
      if (err.message?.includes("Unknown argument")) {
        return prisma.game.update({
          where: { id: game.id },
          data: { currentBlindLevel: currentLevelIndex }
        });
      }
      throw err;
    });
  }

  if (options.emitDealerMessage && io && newLevel.smallBlind != null && newLevel.bigBlind != null) {
    const msg = `Blinds ${newLevel.smallBlind.toLocaleString()}/${newLevel.bigBlind.toLocaleString()}`;
    for (const game of games) {
      io.to(`game:${game.id}`).emit("game_message", {
        gameId: game.id,
        message: {
          id: `dealer-${Date.now()}-${game.id}`,
          userId: "DEALER",
          userName: "Dealer",
          message: msg,
          timestamp: Date.now(),
          isGameMessage: true,
          isDealerMessage: true
        }
      });
    }
  }

  console.log(`[TOURNAMENT] Synced blind level to ${currentLevelIndex} for ${games.length} table(s) (${newLevel.smallBlind}/${newLevel.bigBlind})`);
  return { currentLevelIndex, newLevel, games };
}

export class TournamentEngine {
  /**
   * Close registration: seat players into tables but don't start the game.
   */
  async closeRegistration(tournamentId) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        games: true
      }
    });

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    if (tournament.status !== "REGISTERING" && tournament.status !== "SCHEDULED") {
      throw new Error("Can only close registration for REGISTERING or SCHEDULED tournaments");
    }

    // Check if players are already seated
    if (tournament.games && tournament.games.length > 0) {
      throw new Error("Players are already seated");
    }

    // Get registered players count to calculate prize places
    const registeredCount = await prisma.tournamentRegistration.count({
      where: {
        tournamentId,
        status: "CONFIRMED"
      }
    });

    // Calculate prize places: 1 place per 4 registered players
    const prizePlaces = Math.floor(registeredCount / 4);
    console.log(`[TOURNAMENT] Calculated prize places: ${prizePlaces} (from ${registeredCount} registered players)`);

    // Seat players
    const games = await this.seatPlayers(tournamentId);

    // Update status to SEATED and prize places
    const updatedTournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: "SEATED",
        prizePlaces: prizePlaces
      }
    });

    // Update Discord embeds to show registration closed message
    try {
      const { updateTournamentEmbeds } = await import("../discord/bot.js");
      await updateTournamentEmbeds(tournamentId);
    } catch (error) {
      console.error("[TOURNAMENT ENGINE] Error updating Discord embeds:", error);
      // Don't fail the whole operation if Discord update fails
    }

    return { tournamentId, games };
  }

  /**
   * Start a tournament: mark RUNNING (players should already be seated).
   * @param {string} tournamentId - Tournament ID
   * @param {object} io - Socket.IO server instance (optional, for starting hands)
   */
  async startTournament(tournamentId, io = null) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        games: {
          include: {
            players: true
          }
        }
      }
    });

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    if (tournament.status === "RUNNING" || tournament.status === "COMPLETED" || tournament.status === "CANCELLED") {
      throw new Error("Tournament already started, completed, or cancelled");
    }

    // Tournament must be SEATED before starting (players must be seated first)
    if (tournament.status !== "SEATED") {
      throw new Error("Tournament must be SEATED (registration closed and players seated) before starting");
    }

    // Ensure games exist
    if (!tournament.games || tournament.games.length === 0) {
      throw new Error("No games found - players must be seated first");
    }

    // Get Socket.IO instance
    const { getIO } = await import("../modules/socket-handlers/pokerHandler.js");
    const socketIO = io || getIO();

    // Send Discord embed notification: "Game starting in 2 mins - take your seats"
    try {
      const { postTournamentStartingEmbed } = await import("../discord/bot.js");
      await postTournamentStartingEmbed(tournament);
    } catch (err) {
      console.error(`[TOURNAMENT] Error posting Discord starting notification:`, err);
    }

    // Persist scheduled start so it survives process restart (e.g. Render)
    const startScheduledAt = new Date(Date.now() + 2 * 60 * 1000);
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { startScheduledAt }
    });
    // Start exactly when timer expires (poll every 30s would add up to 30s delay)
    if (_scheduledStartTimers.has(tournamentId)) {
      clearTimeout(_scheduledStartTimers.get(tournamentId).timeoutId);
      _scheduledStartTimers.delete(tournamentId);
    }
    const delayMs = Math.max(0, startScheduledAt.getTime() - Date.now());
    const timeoutId = setTimeout(() => {
      _scheduledStartTimers.delete(tournamentId);
      this.runScheduledStart(tournamentId).catch((err) =>
        console.error(`[TOURNAMENT] Scheduled start timer error for ${tournamentId}:`, err)
      );
    }, delayMs);
    _scheduledStartTimers.set(tournamentId, { timeoutId });
    if (socketIO) {
      for (const game of tournament.games || []) {
        socketIO.to(`game:${game.id}`).emit("tournament-starting", {
          tournamentId,
          startTime: startScheduledAt.toISOString(),
          countdownSeconds: 120
        });
      }
      socketIO.emit("tournament-starting", {
        tournamentId,
        startTime: startScheduledAt.toISOString(),
        countdownSeconds: 120
      });
      console.log(`[TOURNAMENT] Scheduled start at ${startScheduledAt.toISOString()} for tournament ${tournamentId} (timer in ${(delayMs / 1000).toFixed(0)}s)`);
    }
    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { games: { include: { players: true } } }
    });
    return { tournamentId, games: updatedTournament?.games || [] };
  }

  /** Run actual start (RUNNING, hands, blind timer). Used when startScheduledAt has passed. */
  async runScheduledStart(tournamentId) {
    if (_scheduledStartTimers.has(tournamentId)) {
      clearTimeout(_scheduledStartTimers.get(tournamentId).timeoutId);
      _scheduledStartTimers.delete(tournamentId);
    }
    const existing = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { status: true }
    });
    if (!existing || existing.status !== "SEATED") return;
    const { getIO } = await import("../modules/socket-handlers/pokerHandler.js");
    const socketIO = getIO();
    const startedAt = new Date();
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: "RUNNING", startedAt, startScheduledAt: null }
    });
    if (socketIO) {
      socketIO.emit("tournament-started", { tournamentId, startedAt: startedAt.toISOString() });
      console.log(`[TOURNAMENT] Started tournament ${tournamentId}`);
    }
    const { startHandForGame, hasActiveHand } = await import("../modules/socket-handlers/pokerHandler.js");
    const games = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: { players: { where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } }, include: { user: true } }, tournament: true }
    });
    for (const game of games) {
      const count = game.players?.length ?? 0;
      if (count >= 2) {
        try {
          await startHandForGame(game.id, socketIO);
          console.log(`[TOURNAMENT] Started hand for table ${game.tableNumber} (game ${game.id}, ${count} players)`);
        } catch (err) {
          console.error(`[TOURNAMENT] Error starting hand for game ${game.id} (table ${game.tableNumber}):`, err);
        }
      } else {
        console.log(`[TOURNAMENT] Skipping table ${game.tableNumber}: ${count} players (need 2+)`);
      }
    }
    this.startBlindLevelTimer(tournamentId);
  }

  /**
   * Start blind level progression timer for a running tournament
   */
  startBlindLevelTimer(tournamentId) {
    // Clear existing timer if any
    if (this.blindTimers && this.blindTimers.has(tournamentId)) {
      clearInterval(this.blindTimers.get(tournamentId));
      this.blindTimers.delete(tournamentId);
    }

    // Initialize timers map if needed
    if (!this.blindTimers) {
      this.blindTimers = new Map();
    }

    // Check tournament blind levels every minute
    console.log(`[TOURNAMENT] Blind level timer started for tournament ${tournamentId}, checking every 60 seconds`);
    const intervalId = setInterval(async () => {
      try {
        const tournament = await prisma.tournament.findUnique({
          where: { id: tournamentId },
        });

        if (!tournament || tournament.status !== 'RUNNING' || !tournament.startedAt) {
          // Tournament not running, clear timer
          console.log(`[TOURNAMENT] Tournament ${tournamentId} not running, clearing blind timer`);
          clearInterval(intervalId);
          if (this.blindTimers) {
            this.blindTimers.delete(tournamentId);
          }
          return;
        }
        
        console.log(`[TOURNAMENT] Blind timer check for tournament ${tournamentId}`);

        // Parse blind levels
        let blindLevels = [];
        try {
          blindLevels = tournament.blindLevelsJson ? JSON.parse(tournament.blindLevelsJson) : [];
        } catch (e) {
          console.error(`[TOURNAMENT] Failed to parse blind levels for tournament ${tournamentId}:`, e);
          return;
        }

        if (blindLevels.length === 0) return;

        // Calculate elapsed time since tournament started
        const now = new Date();
        const startedAt = new Date(tournament.startedAt);
        const elapsedMs = now.getTime() - startedAt.getTime();
        let elapsedMinutes = elapsedMs / 1000 / 60;

        // Determine current blind level based on elapsed time
        let currentLevelIndex = 0;
        for (let i = 0; i < blindLevels.length; i++) {
          const level = blindLevels[i];
          if (level.duration === null) {
            // Final level (infinite duration)
            currentLevelIndex = i;
            break;
          }
          if (elapsedMinutes <= level.duration) {
            currentLevelIndex = i;
            break;
          }
          elapsedMinutes -= level.duration;
          // Account for break after level
          if (level.breakAfter) {
            elapsedMinutes -= level.breakAfter;
          }
        }

        const games = await prisma.game.findMany({
          where: { tournamentId, status: "ACTIVE" },
          select: { id: true, currentBlindLevel: true }
        });
        if (games.length === 0) return;

        // Sync all tables to the level dictated by tournament elapsed time (same level for everyone)
        const gameLevel = games[0].currentBlindLevel ?? 0;
        if (currentLevelIndex > gameLevel) {
          console.log(`[TOURNAMENT] Advancing blind level for tournament ${tournamentId} from ${gameLevel} to ${currentLevelIndex}`);
          const { getIO } = await import("../modules/socket-handlers/pokerHandler.js");
          const io = getIO();
          await syncBlindLevelsToTournamentTime(tournamentId, io, { emitDealerMessage: true });
        }
      } catch (err) {
        console.error(`[TOURNAMENT] Error in blind level timer for tournament ${tournamentId}:`, err);
      }
    }, 60000); // Check every minute

    this.blindTimers.set(tournamentId, intervalId);
  }

  /**
   * Seat registered players into tables with balanced distribution.
   * All tables must be within 1 player of each other.
   */
  async seatPlayers(tournamentId) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        registrations: {
          where: { status: "CONFIRMED" }
        }
      }
    });

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    const { seatsPerTable } = tournament;
    const registrations = tournament.registrations;

    if (registrations.length === 0) {
      throw new Error("No registered players to seat");
    }

    // Shuffle players randomly
    const shuffled = [...registrations].sort(() => Math.random() - 0.5);

    // Calculate number of tables needed
    const totalPlayers = shuffled.length;
    const numTables = Math.ceil(totalPlayers / seatsPerTable);
    
    // Calculate balanced distribution
    // Each table should have either floor(players/tables) or ceil(players/tables) players
    const basePlayersPerTable = Math.floor(totalPlayers / numTables);
    const extraPlayers = totalPlayers % numTables;
    
    // Create tables with balanced distribution
    const tables = [];
    let playerIndex = 0;
    
    for (let tableNumber = 1; tableNumber <= numTables; tableNumber++) {
      // First 'extraPlayers' tables get one extra player
      const playersForThisTable = tableNumber <= extraPlayers 
        ? basePlayersPerTable + 1 
        : basePlayersPerTable;
      
      const tablePlayers = shuffled.slice(playerIndex, playerIndex + playersForThisTable);
      playerIndex += playersForThisTable;

      if (tablePlayers.length === 0) {
        // Skip empty tables
        continue;
      }

      const game = await prisma.game.create({
        data: {
          tournamentId,
          tableNumber,
          status: "ACTIVE",
          pot: 0,
          communityCards: ""
        }
      });

      for (let i = 0; i < tablePlayers.length; i++) {
        const reg = tablePlayers[i];
        await prisma.player.create({
          data: {
            gameId: game.id,
            userId: reg.userId,
            seatNumber: i + 1,
            chips: tournament.startingChips,
            holeCards: "",
            status: "ACTIVE"
          }
        });
      }

      tables.push(game);
    }

    console.log(`[TOURNAMENT] Seated ${totalPlayers} players into ${tables.length} balanced tables`);
    const gamesWithPlayers = await prisma.game.findMany({
      where: { tournamentId },
      include: { _count: { select: { players: true } } }
    });
    gamesWithPlayers.forEach((g) => {
      console.log(`[TOURNAMENT]   Table ${g.tableNumber}: ${g._count.players} players`);
    });

    return tables;
  }

  /**
   * Check if a game has an active hand in progress
   */
  async hasActiveHand(gameId) {
    try {
      const { hasActiveHand } = await import("../modules/socket-handlers/pokerHandler.js");
      return hasActiveHand(gameId);
    } catch (e) {
      console.error(`[TOURNAMENT] Error checking active hand for game ${gameId}:`, e);
      return false;
    }
  }

  /**
   * Wait for all tables to finish their current hands before rebalancing.
   * If a table reports "active hand" for longer than stuckHandMs, we clear that game's state
   * so consolidation can proceed (hand was stuck, e.g. disconnected player's turn).
   */
  async waitForAllTablesToFinishHands(tournamentId, maxWaitMs = 120000, stuckHandMs = 90000) {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds
    const activeSince = new Map(); // gameId -> first time we saw it with active hand

    return new Promise((resolve) => {
      const checkHands = async () => {
        const games = await prisma.game.findMany({
          where: { tournamentId, status: "ACTIVE" },
          include: { players: true }
        });

        let allHandsFinished = true;
        for (const game of games) {
          const hasHand = await this.hasActiveHand(game.id);
          if (hasHand) {
            const now = Date.now();
            if (!activeSince.has(game.id)) activeSince.set(game.id, now);
            const stuckFor = now - activeSince.get(game.id);
            if (stuckFor >= stuckHandMs) {
              try {
                const { clearAllStateForGames } = await import("../modules/socket-handlers/pokerHandler.js");
                clearAllStateForGames([game.id]);
                console.log(`[TOURNAMENT] Table ${game.tableNumber} hand stuck ${(stuckFor / 1000).toFixed(0)}s - cleared state so consolidation can proceed`);
                activeSince.delete(game.id);
              } catch (e) {
                console.warn(`[TOURNAMENT] Could not clear stuck hand for game ${game.id}:`, e?.message);
              }
              continue;
            }
            allHandsFinished = false;
            console.log(`[TOURNAMENT] Table ${game.tableNumber} still has active hand, waiting... (${(stuckFor / 1000).toFixed(0)}s)`);
            break;
          }
          activeSince.delete(game.id);
        }

        if (allHandsFinished) {
          console.log(`[TOURNAMENT] All tables have finished their hands, proceeding with rebalancing`);
          resolve(true);
          return;
        }

        if (Date.now() - startTime > maxWaitMs) {
          console.log(`[TOURNAMENT] Max wait time exceeded (${(maxWaitMs / 1000).toFixed(0)}s), proceeding with rebalancing anyway`);
          resolve(false);
          return;
        }

        setTimeout(checkHands, checkInterval);
      };

      checkHands();
    });
  }

  _consolidationLocks = new Map();

  /**
   * Rebalance tables: reduce table count as players eliminated, then balance.
   * 36 players @ 9 max = 4 tables, 27 = 3, 18 = 2, 9 = 1 (final table).
   */
  async consolidateTables(tournamentId) {
    const existing = this._consolidationLocks?.get(tournamentId);
    if (existing) {
      await existing;
      return this.consolidateTables(tournamentId);
    }
    const p = this._doConsolidateTables(tournamentId);
    this._consolidationLocks = this._consolidationLocks || new Map();
    this._consolidationLocks.set(tournamentId, p);
    try {
      return await p;
    } finally {
      this._consolidationLocks.delete(tournamentId);
    }
  }

  async _doConsolidateTables(tournamentId) {
    console.log(`[TOURNAMENT] Starting table consolidation for tournament ${tournamentId}`);

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { seatsPerTable: true }
    });
    const seatsPerTable = tournament?.seatsPerTable ?? 9;

    // Load current table counts to see if we actually need to consolidate
    let games = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: {
        players: {
          where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
          include: { user: true }
        }
      },
      orderBy: { tableNumber: "asc" }
    });

    const totalCount = games.reduce((sum, g) => sum + (g.players?.length ?? 0), 0);
    const tablesNeeded = Math.max(1, Math.ceil(totalCount / seatsPerTable));
    const counts = games.map(g => g.players?.length ?? 0).filter(c => c > 0);
    const maxC = counts.length ? Math.max(...counts) : 0;
    const minC = counts.length ? Math.min(...counts) : 0;
    const spread = maxC - minC;

    // No need to consolidate: we're not closing tables AND tables are already balanced (spread <= 1)
    if (games.length <= tablesNeeded && spread <= 1) {
      console.log(`[TOURNAMENT] Skipping consolidation: ${games.length} tables, counts ${counts.join(",")}, spread ${spread} (no rebalance needed)`);
      return games;
    }

    // Short delay so the table that just finished can show showdown (who won) before we show "waiting"
    await new Promise((r) => setTimeout(r, 4000));

    const gamesToWait = games.map(g => ({ id: g.id }));
    if (gamesToWait.length > 0) {
      try {
        const { getIO } = await import("../modules/socket-handlers/pokerHandler.js");
        const io = getIO();
        if (io) {
          for (const g of gamesToWait) {
            const hasHand = await this.hasActiveHand(g.id);
            if (!hasHand) {
              io.to(`game:${g.id}`).emit("consolidation-waiting", {
                message: "Waiting for other tables to finish their hands before reseating...",
                tournamentId
              });
            }
          }
        }
      } catch (e) {
        console.warn("[TOURNAMENT] Could not emit consolidation-waiting:", e?.message);
      }
    }

    await this.waitForAllTablesToFinishHands(tournamentId);

    // Re-fetch games after wait (state may have changed)
    games = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: {
        players: {
          where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
          include: { user: true }
        }
      },
      orderBy: { tableNumber: "asc" }
    });

    console.log(`[TOURNAMENT] Consolidation: found ${games.length} ACTIVE table(s), player counts (in-tournament):`, games.map(g => `${g.tableNumber}:${g.players?.length ?? 0}`));

    const allActiveGameIdsForClear = games.map(g => g.id);

    const allPlayers = [];
    for (const game of games) {
      for (const player of game.players) {
        allPlayers.push({
          playerId: player.id,
          gameId: game.id,
          userId: player.userId,
          chips: player.chips,
          seatNumber: player.seatNumber,
          player
        });
      }
    }
    const totalPlayers = allPlayers.length;
    const numTablesNeeded = Math.max(1, Math.ceil(totalPlayers / seatsPerTable));
    
    if (games.length > numTablesNeeded) {
      // Close the tables with the FEWEST players first, so we keep the tables that have players.
      // Previously we closed the last N by table number, which could close the only table with players.
      const byPlayerCount = [...games].sort((a, b) => (a.players?.length ?? 0) - (b.players?.length ?? 0));
      const toClose = byPlayerCount.slice(0, byPlayerCount.length - numTablesNeeded);
      const toKeep = byPlayerCount.slice(-numTablesNeeded);
      for (const g of toClose) {
        await prisma.game.update({ where: { id: g.id }, data: { status: "COMPLETED" } });
      }
      games = toKeep;
      console.log(`[TOURNAMENT] Reduced to ${numTablesNeeded} table(s) (closed ${toClose.length} emptiest)`);
    }

    // Always redistribute when we have players - even with 1 table we must move players
    // from closed tables into the remaining table. Previously we returned early and left
    // players stranded at closed tables.
    if (totalPlayers === 0) {
      console.log(`[TOURNAMENT] No players remaining, skipping redistribution`);
      return games;
    }

    const numTables = games.length;
    
    // Calculate balanced distribution
    const basePlayersPerTable = Math.floor(totalPlayers / numTables);
    const extraPlayers = totalPlayers % numTables;
    
    console.log(`[TOURNAMENT] Rebalancing ${totalPlayers} players across ${numTables} tables`);
    console.log(`[TOURNAMENT] Target: ${basePlayersPerTable}-${basePlayersPerTable + 1} players per table`);

    // Shuffle players to redistribute fairly
    const shuffled = [...allPlayers].sort(() => Math.random() - 0.5);
    
    // Build target assignment: which players should be at which tables
    const tableAssignments = [];
    let playerIndex = 0;
    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      const targetPlayers = i < extraPlayers ? basePlayersPerTable + 1 : basePlayersPerTable;
      const playersForThisTable = shuffled.slice(playerIndex, playerIndex + targetPlayers);
      playerIndex += targetPlayers;
      
      tableAssignments.push({
        gameId: game.id,
        tableNumber: game.tableNumber,
        players: playersForThisTable
      });
    }

    // CRITICAL: Clear in-memory state for ALL ACTIVE tournament games BEFORE deleting players.
    try {
      const { clearAllStateForGames } = await import("../modules/socket-handlers/pokerHandler.js");
      clearAllStateForGames(allActiveGameIdsForClear);
    } catch (e) {
      console.warn("[TOURNAMENT] Could not clear game state:", e?.message);
    }

    // Run delete + recreate in a single transaction so we never leave DB with partial state (e.g. 1 player)
    await prisma.$transaction(async (tx) => {
      for (const player of allPlayers) {
        await tx.player.delete({ where: { id: player.playerId } });
      }
      for (const assignment of tableAssignments) {
        await tx.player.deleteMany({ where: { gameId: assignment.gameId } });
      }
      for (const assignment of tableAssignments) {
        for (let seatIndex = 0; seatIndex < assignment.players.length; seatIndex++) {
          const { player } = assignment.players[seatIndex];
          if (!player?.userId) {
            throw new Error(`[TOURNAMENT] Invalid player in assignment table ${assignment.tableNumber} seat ${seatIndex + 1}`);
          }
          await tx.player.create({
            data: {
              gameId: assignment.gameId,
              userId: player.userId,
              seatNumber: seatIndex + 1,
              chips: player.chips,
              holeCards: "",
              status: "ACTIVE"
            }
          });
        }
      }
    });

    // Verify balance
    const updatedGames = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: { 
        players: {
          where: { status: "ACTIVE" }
        }
      }
    });

    const playerCounts = updatedGames.map(g => g.players.length);
    const minPlayers = Math.min(...playerCounts);
    const maxPlayers = Math.max(...playerCounts);
    
    console.log(`[TOURNAMENT] Rebalancing complete. Player counts per table:`, playerCounts);
    console.log(`[TOURNAMENT] Min: ${minPlayers}, Max: ${maxPlayers}, Difference: ${maxPlayers - minPlayers}`);
    
    if (maxPlayers - minPlayers > 1) {
      console.warn(`[TOURNAMENT] WARNING: Tables are not balanced! Max difference is ${maxPlayers - minPlayers}`);
    }

    // Sync all tables to same blind level (from tournament time) so they resume in sync
    try {
      const { getIO } = await import("../modules/socket-handlers/pokerHandler.js");
      const io = getIO();
      await syncBlindLevelsToTournamentTime(tournamentId, io, { emitDealerMessage: false });
    } catch (e) {
      console.warn("[TOURNAMENT] Could not sync blind levels after rebalancing:", e?.message);
    }

    // Start hands for ALL tables at once so play resumes together
    try {
      const { startHandForGame, getIO } = await import("../modules/socket-handlers/pokerHandler.js");
      const io = getIO();
      if (io) {
        const startPromises = [];
        for (const g of updatedGames) {
          if (g.players.length >= 2 && !(await this.hasActiveHand(g.id))) {
            startPromises.push(
              startHandForGame(g.id, io)
                .then(() => console.log(`[TOURNAMENT] Started hand for table ${g.tableNumber} after rebalancing (${g.players.length} players)`))
                .catch((err) => console.error(`[TOURNAMENT] Error starting hand for table ${g.tableNumber}:`, err?.message))
            );
          }
        }
        await Promise.all(startPromises);
        if (startPromises.length > 0) {
          io.emit("consolidation-complete", { tournamentId });
        }
      }
    } catch (e) {
      console.warn("[TOURNAMENT] Could not start hands after rebalancing:", e?.message);
    }

    // Notify all game rooms so lobby can refetch
    try {
      const { getIO } = await import("../modules/socket-handlers/pokerHandler.js");
      const io = getIO();
      if (io) {
        for (const g of updatedGames) {
          io.to(`game:${g.id}`).emit("tournament_updated", { tournamentId });
        }
        io.emit("tournament_updated", { tournamentId }); // Lobby listeners
      }
    } catch (e) {
      console.warn("[TOURNAMENT] Could not emit tournament_updated:", e?.message);
    }

    return updatedGames;
  }

  /**
   * Mark multiple players as eliminated and run consolidation once.
   * Batches busts to avoid race conditions when multiple players bust in same hand.
   */
  async onPlayersBust(tournamentId, playerIds) {
    if (!playerIds || playerIds.length === 0) return;
    for (const playerId of playerIds) {
      await this._markPlayerBust(tournamentId, playerId);
    }
    const remaining = await prisma.player.count({
      where: { game: { tournamentId }, chips: { gt: 0 }, status: "ACTIVE" }
    });
    // Only complete when exactly one player left (one winner). remaining === 0 would be a bug.
    if (remaining === 1) {
      const winner = await prisma.player.findFirst({
        where: { game: { tournamentId }, chips: { gt: 0 }, status: "ACTIVE" },
        include: { user: true, game: true }
      });
      if (winner) {
        const current = await prisma.tournament.findUnique({
          where: { id: tournamentId },
          select: { status: true }
        });
        if (current?.status === "COMPLETED") {
          return; // Already completed (e.g. race) - do not post Discord again
        }
        await prisma.player.update({
          where: { id: winner.id },
          data: { finishingPlace: 1 }
        });
        await prisma.tournament.update({
          where: { id: tournamentId },
          data: { status: "COMPLETED" }
        });
        try {
          const tournament = await prisma.tournament.findUnique({
            where: { id: tournamentId },
            include: { games: { include: { players: { include: { user: true } } } } }
          });
          if (tournament) {
            const { postTournamentWinnersEmbed } = await import("../discord/bot.js");
            await postTournamentWinnersEmbed(tournament);
          }
        } catch (err) {
          console.error("[TOURNAMENT] Error posting winners embed:", err);
        }
      }
    } else if (remaining > 1) {
      await this.consolidateTables(tournamentId);
    }
  }

  /** Mark a single player as bust - only updates DB, no consolidation (handled by onPlayersBust) */
  async _markPlayerBust(tournamentId, playerId) {
    await prisma.player.update({
      where: { id: playerId },
      data: { status: "ELIMINATED" }
    });
    const remaining = await prisma.player.count({
      where: { game: { tournamentId }, chips: { gt: 0 }, status: "ACTIVE" }
    });
    const finishingPlace = remaining + 1;
    await prisma.player.update({
      where: { id: playerId },
      data: { finishingPlace }
    }).catch((err) => {
      console.error(`[TOURNAMENT] Error setting finishingPlace for player ${playerId}:`, err);
    });
  }

  /** Legacy: single bust (e.g. uncalled bet). Delegates to onPlayersBust. */
  async onPlayerBust(tournamentId, playerId) {
    await this.onPlayersBust(tournamentId, [playerId]);
  }

  /**
   * Simple blind level progression: increment currentBlindLevel on active games.
   */
  async advanceBlindLevel(tournamentId) {
    const games = await prisma.game.findMany({
      where: {
        tournamentId,
        status: "ACTIVE"
      }
    });

    const updated = [];
    for (const game of games) {
      const nextLevel = (game.currentBlindLevel || 0) + 1;
      const g = await prisma.game.update({
        where: { id: game.id },
        data: { currentBlindLevel: nextLevel }
      });
      updated.push(g);
    }

    return updated;
  }
}

/** One-time timers so start runs exactly when 2 min expires (poll is backup for restarts). */
const _scheduledStartTimers = new Map(); // tournamentId -> { timeoutId }

/** Poll for tournaments that are SEATED and startScheduledAt <= now; run actual start. Survives process restart. */
let _scheduledStartPollInterval = null;
export function startScheduledStartPoll() {
  if (_scheduledStartPollInterval) return;
  const engine = new TournamentEngine();
  _scheduledStartPollInterval = setInterval(async () => {
    try {
      const now = new Date();
      const due = await prisma.tournament.findMany({
        where: { status: "SEATED", startScheduledAt: { lte: now } },
        select: { id: true }
      });
      for (const t of due) {
        try {
          await engine.runScheduledStart(t.id);
        } catch (err) {
          console.error(`[TOURNAMENT] Error running scheduled start for ${t.id}:`, err);
        }
      }
    } catch (err) {
      console.error(`[TOURNAMENT] Scheduled start poll error:`, err);
    }
  }, 30000);
  console.log("[TOURNAMENT] Scheduled start poll running every 30s");
}

/** Every 60s, ensure every ACTIVE table in a RUNNING tournament has a hand running. Recovers stuck tables. */
let _idleTablesPollInterval = null;
export function startIdleTablesPoll() {
  if (_idleTablesPollInterval) return;
  _idleTablesPollInterval = setInterval(async () => {
    const { startHandForGame, hasActiveHand, getIO } = await import("../modules/socket-handlers/pokerHandler.js");
    const socketIO = getIO();
    if (!socketIO) return;
    try {
      const running = await prisma.tournament.findMany({
        where: { status: "RUNNING" },
        select: { id: true }
      });
      for (const t of running) {
        const games = await prisma.game.findMany({
          where: { tournamentId: t.id, status: "ACTIVE" },
          include: {
            players: {
              where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
              select: { id: true }
            }
          }
        });
        for (const game of games) {
          if (game.players.length === 0) {
            await prisma.game.update({ where: { id: game.id }, data: { status: "COMPLETED" } });
            console.log(`[TOURNAMENT] Closed empty table ${game.tableNumber} (game ${game.id})`);
            continue;
          }
          if (game.players.length < 2) continue;
          if (hasActiveHand(game.id)) continue;
          try {
            await startHandForGame(game.id, socketIO);
            console.log(`[TOURNAMENT] Idle-table recovery: started hand for game ${game.id} (table ${game.tableNumber})`);
          } catch (err) {
            console.error(`[TOURNAMENT] Idle-table start failed for game ${game.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("[TOURNAMENT] Idle tables poll error:", err);
    }
  }, 60000);
  console.log("[TOURNAMENT] Idle tables poll running every 60s");
}


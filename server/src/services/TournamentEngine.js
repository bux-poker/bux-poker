import { prisma } from "../config/database.js";

// TournamentEngine: manages tables, seating, and basic progression.
// This is intentionally simplified but provides real table assignment
// and consolidation hooks.

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

    // Calculate start time (2 minutes from now)
    const startTime = new Date(Date.now() + 2 * 60 * 1000);
    
    // Broadcast tournament starting event with countdown to all clients in tournament games
    if (socketIO) {
      // Emit to all game rooms in this tournament
      for (const game of tournament.games || []) {
        socketIO.to(`game:${game.id}`).emit("tournament-starting", {
          tournamentId,
          startTime: startTime.toISOString(),
          countdownSeconds: 120
        });
      }
      // Also emit globally as fallback
      socketIO.emit("tournament-starting", {
        tournamentId,
        startTime: startTime.toISOString(),
        countdownSeconds: 120
      });
      console.log(`[TOURNAMENT] Broadcasted tournament-starting event for tournament ${tournamentId}, starting in 2 minutes`);
    }

    // Wait 2 minutes before actually starting the game
    setTimeout(async () => {
      try {
    // Mark as RUNNING and record actual start time
    const startedAt = new Date();
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: "RUNNING",
        startedAt: startedAt // Record actual start time
      }
    });

    // Start a hand for each game
        const { startHandForGame } = await import("../modules/socket-handlers/pokerHandler.js");
    
    // Broadcast tournament started event to all clients so they can refetch tournament data
    if (socketIO) {
      socketIO.emit("tournament-started", {
        tournamentId,
        startedAt: startedAt.toISOString()
      });
      console.log(`[TOURNAMENT] Broadcasted tournament-started event for tournament ${tournamentId}`);
    }
    
    if (socketIO) {
      const games = await prisma.game.findMany({
        where: { tournamentId },
        include: {
          players: {
            include: { user: true }
          },
          tournament: true
        }
      });

      for (const game of games) {
        if (game.status === "ACTIVE" && game.players.length >= 2) {
          try {
            await startHandForGame(game.id, socketIO);
          } catch (err) {
            console.error(`[TOURNAMENT] Error starting hand for game ${game.id}:`, err);
          }
        }
      }
    }

    // Start blind level timer
    console.log(`[TOURNAMENT] Starting blind level timer for tournament ${tournamentId}`);
    this.startBlindLevelTimer(tournamentId);
      } catch (err) {
        console.error(`[TOURNAMENT] Error starting tournament after countdown:`, err);
      }
    }, 2 * 60 * 1000); // 2 minutes delay

    // Refresh games after starting hands
    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        games: {
          include: {
            players: true
          }
        }
      }
    });

    return { tournamentId, games: updatedTournament?.games || [] };
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

        // Get current level from games
        const games = await prisma.game.findMany({
          where: {
            tournamentId,
            status: "ACTIVE"
          }
        });

        if (games.length === 0) return;

        // Check if we need to advance to next level
        const gameLevel = games[0].currentBlindLevel || 0;
        if (currentLevelIndex > gameLevel) {
          console.log(`[TOURNAMENT] Advancing blind level for tournament ${tournamentId} from ${gameLevel} to ${currentLevelIndex}`);
          await this.advanceBlindLevel(tournamentId);
          
          // Update blinds in active games and post dealer message to each table
          const newLevel = blindLevels[currentLevelIndex];
          if (newLevel) {
            const { getIO } = await import("../modules/socket-handlers/pokerHandler.js");
            const io = getIO();
            for (const game of games) {
              // Update game blinds - this will affect new hands
              // Existing hands continue with their current blinds
              await prisma.game.update({
                where: { id: game.id },
                data: {
                  smallBlind: newLevel.smallBlind,
                  bigBlind: newLevel.bigBlind
                }
              });
              // Announce new blind level at table
              if (io) {
                const dealerMessage = {
                  id: `dealer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  userId: 'DEALER',
                  userName: 'Dealer',
                  message: `Blinds increase to ${newLevel.smallBlind.toLocaleString()}/${newLevel.bigBlind.toLocaleString()}`,
                  timestamp: Date.now(),
                  isGameMessage: true,
                  isDealerMessage: true
                };
                io.to(`game:${game.id}`).emit("game_message", { gameId: game.id, message: dealerMessage });
              }
            }
          }
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
    tables.forEach((table, idx) => {
      console.log(`[TOURNAMENT]   Table ${table.tableNumber}: ${table.players?.length || 'unknown'} players`);
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
   * Wait for all tables to finish their current hands before rebalancing
   */
  async waitForAllTablesToFinishHands(tournamentId, maxWaitMs = 300000) {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds
    
    return new Promise((resolve) => {
      const checkHands = async () => {
        const games = await prisma.game.findMany({
          where: { tournamentId, status: "ACTIVE" },
          include: { players: true }
        });

        // Check if any table has an active hand
        let allHandsFinished = true;
        for (const game of games) {
          const hasHand = await this.hasActiveHand(game.id);
          if (hasHand) {
            allHandsFinished = false;
            console.log(`[TOURNAMENT] Table ${game.tableNumber} still has active hand, waiting...`);
            break;
          }
        }

        if (allHandsFinished) {
          console.log(`[TOURNAMENT] All tables have finished their hands, proceeding with rebalancing`);
          resolve(true);
          return;
        }

        // Check if we've exceeded max wait time
        if (Date.now() - startTime > maxWaitMs) {
          console.log(`[TOURNAMENT] Max wait time exceeded, proceeding with rebalancing anyway`);
          resolve(false);
          return;
        }

        // Check again after interval
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
    await this.waitForAllTablesToFinishHands(tournamentId);
    
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { seatsPerTable: true }
    });
    const seatsPerTable = tournament?.seatsPerTable ?? 9;
    
    let games = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: { 
        players: {
          where: { status: "ACTIVE" },
          include: { user: true }
        }
      },
      orderBy: { tableNumber: "asc" }
    });

    console.log(`[TOURNAMENT] Consolidation: found ${games.length} ACTIVE table(s), player counts:`, games.map(g => `${g.tableNumber}:${g.players?.length ?? 0}`));

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
      const toClose = games.slice(numTablesNeeded);
      for (const g of toClose) {
        await prisma.game.update({ where: { id: g.id }, data: { status: "COMPLETED" } });
      }
      games = games.slice(0, numTablesNeeded);
      console.log(`[TOURNAMENT] Reduced to ${numTablesNeeded} table(s)`);
    }

    if (games.length <= 1) {
      console.log(`[TOURNAMENT] Only ${games.length} table(s), no rebalancing needed`);
      return games;
    }

    // allPlayers and totalPlayers already computed above
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

    // Step 1: Remove all players from their current tables (we'll recreate them)
    for (const player of allPlayers) {
      await prisma.player.delete({
        where: { id: player.playerId }
      });
    }

    // Step 2: Recreate players at their new tables with balanced distribution
    for (const assignment of tableAssignments) {
      for (let seatIndex = 0; seatIndex < assignment.players.length; seatIndex++) {
        const { player } = assignment.players[seatIndex];
        await prisma.player.create({
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

    // Start hands for tables that have 2+ players and no active hand
    try {
      const { startHandForGame, hasActiveHand, getIO } = await import("../modules/socket-handlers/pokerHandler.js");
      const io = getIO();
      if (io) {
        for (const g of updatedGames) {
          if (g.players.length >= 2 && !(await this.hasActiveHand(g.id))) {
            try {
              await startHandForGame(g.id, io);
              console.log(`[TOURNAMENT] Started hand for table ${g.tableNumber} after rebalancing (${g.players.length} players)`);
            } catch (err) {
              console.error(`[TOURNAMENT] Error starting hand for table ${g.tableNumber}:`, err?.message);
            }
          }
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
      where: { game: { tournamentId }, chips: { gt: 0 } }
    });
    if (remaining <= 1) {
      const winner = await prisma.player.findFirst({
        where: { game: { tournamentId }, chips: { gt: 0 } },
        include: { user: true, game: true }
      });
      if (winner) {
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
    } else {
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
      where: { game: { tournamentId }, chips: { gt: 0 } }
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


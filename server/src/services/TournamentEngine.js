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

    // Seat players
    const games = await this.seatPlayers(tournamentId);

    // Update status to SEATED
    const updatedTournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: "SEATED"
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
    const { startHandForGame, getIO } = await import("../modules/socket-handlers/pokerHandler.js");
    // Use provided io or get from pokerHandler
    const socketIO = io || getIO();
    
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
          
          // Update blinds in active games
          const newLevel = blindLevels[currentLevelIndex];
          if (newLevel) {
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

  /**
   * Rebalance tables: move players to ensure all tables are within 1 player of each other.
   * Waits for all tables to finish current hands before rebalancing.
   */
  async consolidateTables(tournamentId) {
    console.log(`[TOURNAMENT] Starting table consolidation for tournament ${tournamentId}`);
    
    // Wait for all tables to finish their current hands
    await this.waitForAllTablesToFinishHands(tournamentId);
    
    const games = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: { 
        players: {
          where: { status: "ACTIVE" },
          include: { user: true }
        }
      }
    });

    if (games.length <= 1) {
      console.log(`[TOURNAMENT] Only ${games.length} table(s), no rebalancing needed`);
      return games;
    }

    // Collect all active players
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

    return updatedGames;
  }

  /**
   * Mark a player as eliminated and optionally trigger consolidation.
   */
  async onPlayerBust(tournamentId, playerId) {
    await prisma.player.update({
      where: { id: playerId },
      data: {
        status: "ELIMINATED"
      }
    });

    // Count remaining active players across all games
    const remaining = await prisma.player.count({
      where: {
        game: { tournamentId },
        status: "ACTIVE"
      }
    });

    if (remaining <= 1) {
      await prisma.tournament.update({
        where: { id: tournamentId },
        data: {
          status: "COMPLETED"
        }
      });
    } else {
      await this.consolidateTables(tournamentId);
    }
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


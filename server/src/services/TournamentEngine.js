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
   * Seat registered players into tables based on seatsPerTable.
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

    const shuffled = [...registrations].sort(
      () => Math.random() - 0.5
    );

    const tables = [];
    let tableNumber = 1;

    while (shuffled.length > 0) {
      const tablePlayers = shuffled.splice(0, seatsPerTable);

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
      tableNumber += 1;
    }

    return tables;
  }

  /**
   * Basic consolidation stub: in a real engine this would:
   * - find short-handed tables
   * - move players to balance seats
   * For now, we only expose a placeholder.
   */
  async consolidateTables(tournamentId) {
    // TODO: implement real consolidation logic.
    const games = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: { players: true }
    });

    return games;
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


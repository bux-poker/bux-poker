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
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: "SEATED"
      }
    });

    return { tournamentId, games };
  }

  /**
   * Start a tournament: mark RUNNING (players should already be seated).
   */
  async startTournament(tournamentId) {
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

    // If players aren't seated yet, seat them first
    if (!tournament.games || tournament.games.length === 0) {
      await this.seatPlayers(tournamentId);
    }

    // Mark as RUNNING
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: "RUNNING"
      }
    });

    return { tournamentId, games: tournament.games || [] };
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


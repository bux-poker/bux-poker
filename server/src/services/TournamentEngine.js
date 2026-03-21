import { prisma } from "../config/database.js";
import { auditChipConservation } from "./tournament/chipAudit.js";
import {
  getTournamentBlindLevelFromTime,
  syncBlindLevelsToTournamentTime
} from "./tournament/blindLevels.js";
import { consolidateTables as runConsolidateTables } from "./tournament/consolidateTables.js";
import { onPlayersBust as runOnPlayersBust } from "./tournament/busts.js";
import { seatPlayers as runSeatPlayers } from "./tournament/seatPlayers.js";
import { completeTournamentIfOneLeft as runCompleteIfOneLeft } from "./tournament/completeIfOneLeft.js";
import {
  scheduleStart,
  doRunScheduledStart,
  startScheduledStartPoll as startScheduledStartPollImpl,
  resumeScheduledStartTimersForSeatedTournaments as resumeScheduledStartTimersImpl,
} from "./tournament/scheduledStart.js";
import { startTournamentAutomationPoll as startTournamentAutomationPollImpl } from "./tournament/tournamentAutomationPoll.js";
import { startBlindLevelTimer as runStartBlindLevelTimer } from "./tournament/blindTimer.js";
import { startIdleTablesPoll as startIdleTablesPollImpl } from "./tournament/idleTablesPoll.js";

// Re-export for backward compatibility (poker/blindLevel, etc. import from TournamentEngine)
export { getTournamentBlindLevelFromTime, syncBlindLevelsToTournamentTime };

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
    const games = await runSeatPlayers(tournamentId);

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

    if (tournament.startScheduledAt) {
      const at = new Date(tournament.startScheduledAt).getTime();
      if (at > Date.now()) {
        throw new Error(
          "A start countdown is already scheduled — play will begin automatically at that time"
        );
      }
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
    scheduleStart(tournamentId, startScheduledAt, socketIO, tournament.games || [], (tid) => this.runScheduledStart(tid));
    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { games: { include: { players: true } } }
    });
    return { tournamentId, games: updatedTournament?.games || [] };
  }

  /**
   * Arm countdown so play begins at tournament.startTime (scheduled create-time).
   * If that time has passed, starts the tournament immediately.
   */
  async scheduleOfficialStartCountdown(tournamentId, io = null) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { games: { select: { id: true } } },
    });
    if (!tournament || tournament.status !== "SEATED" || tournament.startedAt) {
      return { skipped: true };
    }

    const officialAt = new Date(tournament.startTime);
    const officialMs = officialAt.getTime();
    const nowMs = Date.now();

    const existingSched = tournament.startScheduledAt
      ? new Date(tournament.startScheduledAt).getTime()
      : null;
    if (existingSched != null && existingSched > nowMs) {
      return { skipped: true, reason: "countdown_in_progress" };
    }
    if (
      existingSched != null &&
      Math.abs(existingSched - officialMs) < 3000
    ) {
      return { skipped: true, reason: "already_armed_for_start_time" };
    }

    const { getIO } = await import("../modules/socket-handlers/pokerHandler.js");
    const socketIO = io || getIO();
    const games = tournament.games?.length
      ? tournament.games
      : await prisma.game.findMany({
          where: { tournamentId },
          select: { id: true },
        });

    if (nowMs >= officialMs) {
      console.log(
        `[TOURNAMENT] scheduleOfficialStartCountdown: start time passed for ${tournamentId} — starting now`
      );
      await this.runScheduledStart(tournamentId);
      return { immediate: true };
    }

    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { startScheduledAt: officialAt },
    });

    try {
      const { postTournamentStartingEmbed } = await import("../discord/bot.js");
      const full = await prisma.tournament.findUnique({ where: { id: tournamentId } });
      if (full) await postTournamentStartingEmbed(full);
    } catch (err) {
      console.error(`[TOURNAMENT] Discord starting notification (auto):`, err);
    }

    scheduleStart(tournamentId, officialAt, socketIO, games, (tid) =>
      this.runScheduledStart(tid)
    );
    return { scheduled: true, startScheduledAt: officialAt.toISOString() };
  }

  /** Run actual start (RUNNING, hands, blind timer). Delegates to tournament/scheduledStart.js. */
  async runScheduledStart(tournamentId) {
    const { getIO, startHandForGame } = await import("../modules/socket-handlers/pokerHandler.js");
    return doRunScheduledStart(tournamentId, {
      getIO,
      startHandForGame,
      startBlindLevelTimer: (tid) => this.startBlindLevelTimer(tid)
    });
  }

  /** Start blind level progression timer. Delegates to tournament/blindTimer.js. */
  startBlindLevelTimer(tournamentId) {
    import("../modules/socket-handlers/pokerHandler.js").then(({ getIO }) => {
      runStartBlindLevelTimer(tournamentId, { getIO });
    }).catch((err) => console.error("[TOURNAMENT] Failed to get getIO for blind timer:", err));
  }

  /**
   * Seat registered players into tables. Delegates to tournament/seatPlayers.js.
   */
  async seatPlayers(tournamentId) {
    return runSeatPlayers(tournamentId);
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
   * Rebalance tables: reduce table count as players eliminated, then balance.
   * Delegates to tournament/consolidateTables.js (lock + wait for hands + doConsolidateTables).
   */
  async consolidateTables(tournamentId) {
    const { getIO, forceStuckPlayerToAct, clearAllStateForGames, startHandForGame } = await import("../modules/socket-handlers/pokerHandler.js");
    return runConsolidateTables(tournamentId, {
      hasActiveHand: (gameId) => this.hasActiveHand(gameId),
      getIO,
      forceStuckPlayerToAct,
      clearAllStateForGames,
      startHandForGame
    });
  }


  /**
   * Mark multiple players as eliminated and run consolidation once.
   * Delegates to tournament/busts.js (lock + markPlayerBust + complete or consolidate).
   */
  async onPlayersBust(tournamentId, playerIds) {
    return runOnPlayersBust(tournamentId, playerIds, {
      consolidateTables: (tid) => this.consolidateTables(tid)
    });
  }

  /**
   * If exactly one player has chips and is not eliminated, mark tournament COMPLETED.
   * Delegates to tournament/completeIfOneLeft.js.
   */
  async completeTournamentIfOneLeft(tournamentId) {
    return runCompleteIfOneLeft(tournamentId);
  }

  /** Single bust (e.g. uncalled bet). Delegates to onPlayersBust. */
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

/** Start scheduled-start poll (SEATED + startScheduledAt <= now). Pass engine or omit to create one. */
export function startScheduledStartPoll(engine) {
  startScheduledStartPollImpl(engine ?? new TournamentEngine());
}

/** Start idle/stuck tables poll. Pass engine or omit to create one. */
export function startIdleTablesPoll(engine) {
  startIdleTablesPollImpl(engine ?? new TournamentEngine());
}

/** Re-arm setTimeout-based starts after process restart. */
export function resumeScheduledStartTimersForSeatedTournaments(engine) {
  return resumeScheduledStartTimersImpl(engine ?? new TournamentEngine());
}

/** Close registration + countdown at startTime - 2m (uses tournament.startTime). */
export function startTournamentAutomationPoll(engine) {
  startTournamentAutomationPollImpl(engine ?? new TournamentEngine());
}

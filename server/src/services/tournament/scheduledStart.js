import { prisma } from "../../config/database.js";

/** One-time timers so start runs exactly when 2 min expires (poll is backup for restarts). */
const scheduledStartTimers = new Map(); // tournamentId -> { timeoutId }

/**
 * Schedule a tournament to run at startScheduledAt; when the timer fires, onTimeExpired(tournamentId) is called.
 * @param {string} tournamentId
 * @param {Date} startScheduledAt
 * @param {object|null} socketIO
 * @param {Array} games - tournament.games for emitting to rooms
 * @param {(tid: string) => Promise<void>} onTimeExpired - e.g. engine.runScheduledStart
 */
export function scheduleStart(tournamentId, startScheduledAt, socketIO, games, onTimeExpired) {
  if (scheduledStartTimers.has(tournamentId)) {
    clearTimeout(scheduledStartTimers.get(tournamentId).timeoutId);
    scheduledStartTimers.delete(tournamentId);
  }
  const delayMs = Math.max(0, startScheduledAt.getTime() - Date.now());
  const timeoutId = setTimeout(() => {
    scheduledStartTimers.delete(tournamentId);
    onTimeExpired(tournamentId).catch((err) =>
      console.error(`[TOURNAMENT] Scheduled start timer error for ${tournamentId}:`, err)
    );
  }, delayMs);
  scheduledStartTimers.set(tournamentId, { timeoutId });

  if (socketIO && games?.length) {
    for (const game of games) {
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
}

/**
 * Clear the in-process timer for a tournament (e.g. before running the start).
 */
export function clearScheduledStartTimer(tournamentId) {
  if (scheduledStartTimers.has(tournamentId)) {
    clearTimeout(scheduledStartTimers.get(tournamentId).timeoutId);
    scheduledStartTimers.delete(tournamentId);
  }
}

/**
 * Run the actual start: set status RUNNING, start hands for all tables, start blind level timer.
 * @param {string} tournamentId
 * @param {{ getIO: () => object, startHandForGame: (gameId, io) => Promise<void>, startBlindLevelTimer: (tid: string) => void }} deps
 */
export async function doRunScheduledStart(tournamentId, deps) {
  const { getIO, startHandForGame, startBlindLevelTimer } = deps;
  clearScheduledStartTimer(tournamentId);

  const existing = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true }
  });
  if (!existing || existing.status !== "SEATED") return;

  const socketIO = getIO();
  const startedAt = new Date();
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      status: "RUNNING",
      startedAt,
      startScheduledAt: null,
      blindPeriodAnchorAt: null,
      tournamentBreakUntilAt: null,
      awaitingHandsForBlindClock: true,
      blindScheduleBarrier: 1,
    },
  });
  await prisma.game.updateMany({
    where: { tournamentId },
    data: { blindBarrierAck: 0 },
  });
  if (socketIO) {
    socketIO.emit("tournament-started", { tournamentId, startedAt: startedAt.toISOString() });
    console.log(`[TOURNAMENT] Started tournament ${tournamentId}`);
  }

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

  startBlindLevelTimer(tournamentId);
}

/**
 * Start the poll that runs scheduled starts for SEATED tournaments with startScheduledAt <= now.
 * @param {{ runScheduledStart: (tournamentId: string) => Promise<void> }} engine - object with runScheduledStart method
 */
let scheduledStartPollInterval = null;
export function startScheduledStartPoll(engine) {
  if (scheduledStartPollInterval) return;
  scheduledStartPollInterval = setInterval(async () => {
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

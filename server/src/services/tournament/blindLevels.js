import { prisma } from "../../config/database.js";
import { hasActiveHand, forceStuckPlayerToAct } from "../../modules/poker/tableState.js";

const _blindWaitActiveSince = new Map(); // gameId -> first-seen-active timestamp
const _blindWaitLastForce = new Map(); // gameId -> last forceStuckPlayerToAct attempt
const _blindAdvanceLocks = new Map(); // tournamentId -> in-flight blind advancement promise

const BLIND_WAIT_STUCK_MS = 90_000;
const BLIND_WAIT_FORCE_THROTTLE_MS = 30_000;

async function recoverStuckHandsWhileBlindWaiting(tournamentId, games, io) {
  const now = Date.now();
  for (const g of games) {
    const active = hasActiveHand(g.id);
    if (!active) {
      _blindWaitActiveSince.delete(g.id);
      _blindWaitLastForce.delete(g.id);
      continue;
    }

    if (!_blindWaitActiveSince.has(g.id)) _blindWaitActiveSince.set(g.id, now);
    const activeForMs = now - (_blindWaitActiveSince.get(g.id) ?? now);
    const waitSec = Math.round(activeForMs / 1000);

    if (activeForMs >= BLIND_WAIT_STUCK_MS) {
      const last = _blindWaitLastForce.get(g.id) ?? 0;
      if (now - last >= BLIND_WAIT_FORCE_THROTTLE_MS) {
        _blindWaitLastForce.set(g.id, now);
        try {
          const ok = await forceStuckPlayerToAct(g.id, io);
          if (ok) {
            console.log(
              `[TOURNAMENT] Blind wait recovery: forced player action at table ${g.tableNumber} after ${waitSec}s`
            );
          }
        } catch (e) {
          console.warn(
            `[TOURNAMENT] Blind wait recovery failed at table ${g.tableNumber}:`,
            e?.message
          );
        }
      }
    }
  }
}

export function parseTournamentBlindLevels(tournament) {
  if (!tournament?.blindLevelsJson) return [];
  try {
    const raw = JSON.parse(tournament.blindLevelsJson);
    return Array.isArray(raw) ? raw : raw?.levels || raw?.blindLevels || [];
  } catch {
    return [];
  }
}

/**
 * Compute current blind level index from tournament start time and blind level durations.
 * Used for lobby / legacy display only; live RUNNING games use anchor + barrier scheduling.
 */
export function getTournamentBlindLevelFromTime(tournament) {
  if (!tournament?.startedAt) return null;
  const blindLevels = parseTournamentBlindLevels(tournament);
  if (blindLevels.length === 0) return null;
  const startedAt = new Date(tournament.startedAt);
  const elapsedMs = Date.now() - startedAt.getTime();
  let elapsedMinutes = elapsedMs / 1000 / 60;
  let currentLevelIndex = 0;
  for (let i = 0; i < blindLevels.length; i++) {
    const level = blindLevels[i];
    if (level.duration == null || level.duration === undefined) {
      currentLevelIndex = i;
      break;
    }
    const levelMinutes = Number(level.duration);
    const dur = Number.isFinite(levelMinutes) && levelMinutes >= 0 ? levelMinutes : 0;
    if (elapsedMinutes <= dur) {
      currentLevelIndex = i;
      break;
    }
    elapsedMinutes -= dur;
    const breakMins = level.breakAfter != null ? Number(level.breakAfter) : 0;
    if (Number.isFinite(breakMins) && breakMins > 0) {
      elapsedMinutes -= breakMins;
    }
  }
  return { currentLevelIndex, blindLevels };
}

function levelSbBb(level) {
  if (!level) return { sb: null, bb: null };
  const sb = level.smallBlind ?? level.small;
  const bb = level.bigBlind ?? level.big;
  return { sb, bb };
}

/**
 * Set every ACTIVE tournament game to the same blind level index and SB/BB from structure.
 */
export async function syncGamesToLevelIndex(tournamentId, levelIndex, io, options = { emitDealerMessage: true }) {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament || tournament.status !== "RUNNING") return null;
  const blindLevels = parseTournamentBlindLevels(tournament);
  if (blindLevels.length === 0) return null;
  const idx = Math.max(0, Math.min(levelIndex, blindLevels.length - 1));
  const newLevel = blindLevels[idx];
  if (!newLevel) return null;
  const { sb, bb } = levelSbBb(newLevel);

  const games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    select: { id: true, tableNumber: true, currentBlindLevel: true },
  });
  if (games.length === 0) return null;

  const updateData = {
    currentBlindLevel: idx,
    ...(sb != null && { smallBlind: sb }),
    ...(bb != null && { bigBlind: bb }),
  };

  for (const game of games) {
    await prisma.game
      .update({
        where: { id: game.id },
        data: updateData,
      })
      .catch((err) => {
        if (err.message?.includes("Unknown argument")) {
          return prisma.game.update({
            where: { id: game.id },
            data: { currentBlindLevel: idx },
          });
        }
        throw err;
      });
  }

  if (options.emitDealerMessage && io && sb != null && bb != null) {
    const msg = `Blinds ${sb.toLocaleString()}/${bb.toLocaleString()}`;
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
          isDealerMessage: true,
        },
      });
    }
  }

  const tableIds = games.map((g) => `T${g.tableNumber}`).join(",");
  console.log(
    `[TOURNAMENT] Synced blind level to ${idx} for ${games.length} table(s) (${tableIds}) (${sb}/${bb})`
  );
  return { currentLevelIndex: idx, newLevel, games };
}

/**
 * Align all tables to the highest stored blind level and matching SB/BB (after consolidation, etc.).
 */
export async function resyncGamesToMaxBlindLevel(tournamentId, io, options = { emitDealerMessage: false }) {
  const games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    select: { currentBlindLevel: true },
  });
  if (games.length === 0) return null;
  const canonical = Math.max(0, ...games.map((g) => g.currentBlindLevel ?? 0));
  return syncGamesToLevelIndex(tournamentId, canonical, io, options);
}

/**
 * Legacy name: now resyncs from stored game levels (no wall-clock jump).
 */
export async function syncBlindLevelsToTournamentTime(tournamentId, io, options = { emitDealerMessage: true }) {
  return resyncGamesToMaxBlindLevel(tournamentId, io, options);
}

async function loadActiveGamesWithPlayers(tournamentId) {
  return prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: {
        where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
      },
    },
  });
}

function countEligiblePlayers(game) {
  return (game.players || []).filter((p) => p.status !== "ELIMINATED" && p.chips > 0).length;
}

/**
 * When all tables that need a hand have started one since the last barrier bump, set blindPeriodAnchorAt = now.
 */
export async function maybeFinalizeBlindPeriodAnchor(tournamentId, io) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      status: true,
      awaitingHandsForBlindClock: true,
      blindScheduleBarrier: true,
    },
  });
  if (!tournament || tournament.status !== "RUNNING" || !tournament.awaitingHandsForBlindClock) {
    return false;
  }

  const barrier = tournament.blindScheduleBarrier ?? 0;
  if (barrier <= 0) return false;
  const games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: {
        where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
      },
    },
  });

  const allReady = games.every((g) => {
    if (countEligiblePlayers(g) < 2) return true;
    return (g.blindBarrierAck ?? 0) >= barrier;
  });

  if (!allReady) return false;

  const now = new Date();
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      blindPeriodAnchorAt: now,
      awaitingHandsForBlindClock: false,
    },
  });

  if (io) {
    for (const g of games) {
      io.to(`game:${g.id}`).emit("blind-level-waiting", {
        tournamentId,
        message: null,
        clear: true,
      });
    }
    io.emit("tournament-blind-clock-started", {
      tournamentId,
      blindPeriodAnchorAt: now.toISOString(),
    });
    io.emit("tournament_updated", { tournamentId });
  }
  console.log(`[TOURNAMENT] Blind period anchor set for ${tournamentId} at ${now.toISOString()}`);
  return true;
}

/**
 * Call after a tournament hand has successfully started (tableState set).
 */
export async function onTournamentHandStartedForBlindClock(tournamentId, gameId, io) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, status: true, awaitingHandsForBlindClock: true, blindScheduleBarrier: true },
  });
  if (!tournament || tournament.status !== "RUNNING" || !tournament.awaitingHandsForBlindClock) {
    return;
  }
  const barrier = tournament.blindScheduleBarrier ?? 0;
  await prisma.game.update({
    where: { id: gameId },
    data: { blindBarrierAck: barrier },
  });
  await maybeFinalizeBlindPeriodAnchor(tournamentId, io);
}

function emitWaitingForHands(io, tournamentId, games, message, pendingLevelIndex) {
  if (!io) return;
  for (const gg of games) {
    io.to(`game:${gg.id}`).emit("blind-level-waiting", {
      tournamentId,
      message,
      pendingLevelIndex,
    });
  }
}

function clearWaiting(io, tournamentId, games) {
  if (!io) return;
  for (const gg of games) {
    io.to(`game:${gg.id}`).emit("blind-level-waiting", {
      tournamentId,
      message: null,
      clear: true,
    });
  }
}

/**
 * Anchor-based blind / break progression:
 * - Level timer runs from blindPeriodAnchorAt + duration(canonicalLevel).
 * - At 0:00 wait until no active hand on any table, then break or level-up + barrier before next anchor.
 * - Break: no new hands until break ends; then level-up + same barrier rules.
 */
async function tryAdvanceBlindsIfDueImpl(tournamentId, io, options = { emitDealerMessage: true }) {
  let tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament || tournament.status !== "RUNNING" || !tournament.startedAt) {
    for (const g of [..._blindWaitActiveSince.keys()]) {
      _blindWaitActiveSince.delete(g);
      _blindWaitLastForce.delete(g);
    }
    return { advanced: false, waiting: false };
  }

  const blindLevels = parseTournamentBlindLevels(tournament);
  if (blindLevels.length === 0) return { advanced: false, waiting: false };

  let games = await loadActiveGamesWithPlayers(tournamentId);
  if (games.length === 0) return { advanced: false, waiting: false };

  // Desync repair: everyone should match max stored level
  const gameLevels = games.map((g) => g.currentBlindLevel ?? 0);
  const canonical = Math.max(0, ...gameLevels);
  const minL = Math.min(...gameLevels);
  if (minL < canonical) {
    await syncGamesToLevelIndex(tournamentId, canonical, io, { emitDealerMessage: false });
    games = await loadActiveGamesWithPlayers(tournamentId);
  }

  const breakUntil = tournament.tournamentBreakUntilAt
    ? new Date(tournament.tournamentBreakUntilAt).getTime()
    : null;
  const nowMs = Date.now();

  // --- Scheduled break active ---
  if (breakUntil != null && nowMs < breakUntil) {
    return { advanced: false, waiting: false, inBreak: true, breakEndsAt: tournament.tournamentBreakUntilAt };
  }

  // --- Break just ended: advance level and require all tables to start a hand before clock ---
  if (breakUntil != null && nowMs >= breakUntil) {
    await recoverStuckHandsWhileBlindWaiting(tournamentId, games, io);
    for (const g of games) {
      if (hasActiveHand(g.id)) {
        emitWaitingForHands(
          io,
          tournamentId,
          games,
          "Waiting for all tables to finish the current hand before play resumes after the break.",
          canonical
        );
        return { advanced: false, waiting: true, inBreak: false };
      }
    }
    clearWaiting(io, tournamentId, games);
    const nextIdx = canonical + 1;
    if (nextIdx >= blindLevels.length) {
      await prisma.tournament.update({
        where: { id: tournamentId },
        data: { tournamentBreakUntilAt: null },
      });
      return { advanced: false, waiting: false };
    }
    await syncGamesToLevelIndex(tournamentId, nextIdx, io, options);
    const newLevel = blindLevels[nextIdx];
    const { sb, bb } = levelSbBb(newLevel);
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        tournamentBreakUntilAt: null,
        blindPeriodAnchorAt: null,
        awaitingHandsForBlindClock: true,
        blindScheduleBarrier: { increment: 1 },
      },
    });
    if (io) {
      for (const gg of games) {
        io.to(`game:${gg.id}`).emit("tournament-schedule-announcement", {
          tournamentId,
          type: "LEVEL_UP",
          levelIndex: nextIdx,
          smallBlind: sb,
          bigBlind: bb,
          message: `Blinds are now ${sb?.toLocaleString?.() ?? sb} / ${bb?.toLocaleString?.() ?? bb}`,
        });
      }
      io.emit("tournament_updated", { tournamentId });
    }
    await maybeFinalizeBlindPeriodAnchor(tournamentId, io);
    return { advanced: true, waiting: false };
  }

  // --- Legacy / bad row: anchor missing while not aligning ---
  if (
    !tournament.blindPeriodAnchorAt &&
    !tournament.awaitingHandsForBlindClock &&
    !tournament.tournamentBreakUntilAt &&
    (tournament.blindScheduleBarrier ?? 0) === 0
  ) {
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { blindPeriodAnchorAt: tournament.startedAt },
    });
    tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  }

  // --- Aligning hands after level/break: try to set anchor ---
  if (tournament.awaitingHandsForBlindClock) {
    await maybeFinalizeBlindPeriodAnchor(tournamentId, io);
    return { advanced: false, waiting: false, aligning: true };
  }

  const anchorMs = tournament.blindPeriodAnchorAt
    ? new Date(tournament.blindPeriodAnchorAt).getTime()
    : null;
  if (anchorMs == null) {
    await maybeFinalizeBlindPeriodAnchor(tournamentId, io);
    return { advanced: false, waiting: false, aligning: true };
  }

  const level = blindLevels[canonical];
  if (!level || level.duration == null || level.duration === undefined) {
    return { advanced: false, waiting: false, atLastLevel: true };
  }
  const levelMinutes = Number(level.duration);
  const dur =
    Number.isFinite(levelMinutes) && levelMinutes >= 0 ? levelMinutes * 60 * 1000 : 0;
  const periodEnd = anchorMs + dur;

  if (nowMs < periodEnd) {
    return { advanced: false, waiting: false };
  }

  await recoverStuckHandsWhileBlindWaiting(tournamentId, games, io);
  for (const g of games) {
    if (hasActiveHand(g.id)) {
      emitWaitingForHands(
        io,
        tournamentId,
        games,
        "Waiting for all tables to finish the current hand before blinds increase.",
        canonical
      );
      return { advanced: false, waiting: true };
    }
  }

  clearWaiting(io, tournamentId, games);

  const breakMins = level.breakAfter != null ? Number(level.breakAfter) : 0;
  if (Number.isFinite(breakMins) && breakMins > 0) {
    const breakEnds = new Date(nowMs + breakMins * 60 * 1000);
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { tournamentBreakUntilAt: breakEnds },
    });
    if (io) {
      for (const gg of games) {
        io.to(`game:${gg.id}`).emit("tournament-schedule-announcement", {
          tournamentId,
          type: "BREAK",
          breakMinutes: breakMins,
          breakEndsAt: breakEnds.toISOString(),
          message: `Tournament break: ${breakMins} minute${breakMins === 1 ? "" : "s"}`,
        });
      }
      io.emit("tournament_updated", { tournamentId });
    }
    console.log(`[TOURNAMENT] Break started for ${tournamentId} until ${breakEnds.toISOString()}`);
    return { advanced: true, waiting: false, breakStarted: true };
  }

  const nextIdx = canonical + 1;
  if (nextIdx >= blindLevels.length) {
    return { advanced: false, waiting: false, atLastLevel: true };
  }

  await syncGamesToLevelIndex(tournamentId, nextIdx, io, options);
  const newLevel = blindLevels[nextIdx];
  const { sb, bb } = levelSbBb(newLevel);
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      blindPeriodAnchorAt: null,
      awaitingHandsForBlindClock: true,
      blindScheduleBarrier: { increment: 1 },
    },
  });

  if (io) {
    for (const gg of games) {
      io.to(`game:${gg.id}`).emit("tournament-schedule-announcement", {
        tournamentId,
        type: "LEVEL_UP",
        levelIndex: nextIdx,
        smallBlind: sb,
        bigBlind: bb,
        message: `Blinds are now ${sb?.toLocaleString?.() ?? sb} / ${bb?.toLocaleString?.() ?? bb}`,
      });
    }
    io.emit("tournament_updated", { tournamentId });
  }
  await maybeFinalizeBlindPeriodAnchor(tournamentId, io);
  return { advanced: true, waiting: false };
}

export async function tryAdvanceBlindsIfDue(tournamentId, io, options = { emitDealerMessage: true }) {
  const existing = _blindAdvanceLocks.get(tournamentId);
  if (existing) {
    // Avoid DB stampedes from concurrent callers (idle poll, startHand, blind timer, socket events).
    return { advanced: false, waiting: false, queued: true };
  }

  const running = tryAdvanceBlindsIfDueImpl(tournamentId, io, options);
  _blindAdvanceLocks.set(tournamentId, running);
  try {
    return await running;
  } finally {
    _blindAdvanceLocks.delete(tournamentId);
  }
}

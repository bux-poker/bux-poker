import { prisma } from "../../config/database.js";
import { hasActiveHand } from "../../modules/poker/tableState.js";

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

/**
 * Sync all ACTIVE games in a RUNNING tournament to the same blind level (from tournament elapsed time).
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

  const tableIds = games.map(g => `T${g.tableNumber}`).join(",");
  console.log(`[TOURNAMENT] Synced blind level to ${currentLevelIndex} for ${games.length} table(s) (${tableIds}) (${newLevel.smallBlind}/${newLevel.bigBlind})`);
  return { currentLevelIndex, newLevel, games };
}

/**
 * Advance tournament blinds when wall-clock schedule is ahead of DB, but only when
 * no table has an active hand (same moment for all tables). Otherwise emit a waiting notice.
 */
export async function tryAdvanceBlindsIfDue(tournamentId, io, options = { emitDealerMessage: true }) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament || tournament.status !== "RUNNING" || !tournament.startedAt) {
    return { advanced: false, waiting: false };
  }

  const result = getTournamentBlindLevelFromTime(tournament);
  if (!result) return { advanced: false, waiting: false };
  const { currentLevelIndex } = result;

  const games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    select: { id: true, tableNumber: true, currentBlindLevel: true },
  });
  if (games.length === 0) return { advanced: false, waiting: false };

  const gameLevels = games.map((g) => g.currentBlindLevel ?? 0);
  const minGameLevel = Math.min(...gameLevels);

  if (currentLevelIndex <= minGameLevel) {
    return { advanced: false, waiting: false };
  }

  for (const g of games) {
    if (hasActiveHand(g.id)) {
      // Single-table tournaments: no "wait for other tables" UX — blinds sync as soon as this hand ends.
      if (games.length > 1) {
        const msg =
          "Waiting for all tables to finish the current hand before blinds increase.";
        if (io) {
          for (const gg of games) {
            io.to(`game:${gg.id}`).emit("blind-level-waiting", {
              tournamentId,
              message: msg,
              pendingLevelIndex: currentLevelIndex,
            });
          }
        }
      }
      return { advanced: false, waiting: true };
    }
  }

  await syncBlindLevelsToTournamentTime(tournamentId, io, options);
  if (io) {
    io.emit("tournament_updated", { tournamentId });
    for (const g of games) {
      io.to(`game:${g.id}`).emit("blind-level-waiting", {
        tournamentId,
        message: null,
        clear: true,
      });
    }
  }
  return { advanced: true, waiting: false };
}

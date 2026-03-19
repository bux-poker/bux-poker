import { prisma } from "../../config/database.js";
import { getTournamentBlindLevelFromTime, syncBlindLevelsToTournamentTime } from "./blindLevels.js";

const blindTimers = new Map(); // tournamentId -> intervalId

/**
 * After process restart, blind timers are lost. Resume them for all RUNNING tournaments.
 * @param {{ getIO: () => object }} deps
 */
export async function resumeBlindLevelTimersForRunningTournaments(deps) {
  const { getIO } = deps;
  try {
    const running = await prisma.tournament.findMany({
      where: { status: "RUNNING", startedAt: { not: null } },
      select: { id: true }
    });
    const io = getIO();
    for (const t of running) {
      const tournament = await prisma.tournament.findUnique({ where: { id: t.id } });
      const result = getTournamentBlindLevelFromTime(tournament);
      if (result) {
        const games = await prisma.game.findMany({
          where: { tournamentId: t.id, status: "ACTIVE" },
          select: { currentBlindLevel: true }
        });
        if (games.length > 0) {
          const gameLevel = games[0].currentBlindLevel ?? 0;
          if (result.currentLevelIndex > gameLevel) {
            console.log(
              `[TOURNAMENT] Startup blind catch-up for ${t.id}: ${gameLevel} -> ${result.currentLevelIndex}`
            );
            await syncBlindLevelsToTournamentTime(t.id, io, { emitDealerMessage: !!io });
          }
        }
      }
      startBlindLevelTimer(t.id, deps);
      console.log(`[TOURNAMENT] Resumed blind level timer for tournament ${t.id}`);
    }
  } catch (e) {
    console.error("[TOURNAMENT] Failed to resume blind timers:", e?.message);
  }
}

/**
 * Start the blind level progression timer for a running tournament (check every 60s).
 * @param {string} tournamentId
 * @param {{ getIO: () => object }} deps
 */
export function startBlindLevelTimer(tournamentId, deps) {
  if (blindTimers.has(tournamentId)) {
    clearInterval(blindTimers.get(tournamentId));
    blindTimers.delete(tournamentId);
  }

  const { getIO } = deps;
  console.log(`[TOURNAMENT] Blind level timer started for tournament ${tournamentId}, checking every 60 seconds`);
  const intervalId = setInterval(async () => {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId }
      });

      if (!tournament || tournament.status !== "RUNNING" || !tournament.startedAt) {
        console.log(`[TOURNAMENT] Tournament ${tournamentId} not running, clearing blind timer`);
        clearInterval(intervalId);
        blindTimers.delete(tournamentId);
        return;
      }

      console.log(`[TOURNAMENT] Blind timer check for tournament ${tournamentId}`);

      const result = getTournamentBlindLevelFromTime(tournament);
      if (!result) return;
      const { currentLevelIndex } = result;

      const games = await prisma.game.findMany({
        where: { tournamentId, status: "ACTIVE" },
        select: { id: true, currentBlindLevel: true }
      });
      if (games.length === 0) return;

      const gameLevel = games[0].currentBlindLevel ?? 0;
      if (currentLevelIndex > gameLevel) {
        console.log(`[TOURNAMENT] Advancing blind level for tournament ${tournamentId} from ${gameLevel} to ${currentLevelIndex}`);
        const io = getIO();
        await syncBlindLevelsToTournamentTime(tournamentId, io, { emitDealerMessage: true });
      }
    } catch (err) {
      console.error(`[TOURNAMENT] Error in blind level timer for tournament ${tournamentId}:`, err);
    }
  }, 60000);

  blindTimers.set(tournamentId, intervalId);
}

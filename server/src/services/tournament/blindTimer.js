import { prisma } from "../../config/database.js";
import { syncBlindLevelsToTournamentTime } from "./blindLevels.js";

const blindTimers = new Map(); // tournamentId -> intervalId

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

      let blindLevels = [];
      try {
        blindLevels = tournament.blindLevelsJson ? JSON.parse(tournament.blindLevelsJson) : [];
      } catch (e) {
        console.error(`[TOURNAMENT] Failed to parse blind levels for tournament ${tournamentId}:`, e);
        return;
      }

      if (blindLevels.length === 0) return;

      const now = new Date();
      const startedAt = new Date(tournament.startedAt);
      let elapsedMinutes = (now.getTime() - startedAt.getTime()) / 1000 / 60;

      let currentLevelIndex = 0;
      for (let i = 0; i < blindLevels.length; i++) {
        const level = blindLevels[i];
        if (level.duration === null) {
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

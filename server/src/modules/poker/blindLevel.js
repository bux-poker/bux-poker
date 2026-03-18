import { prisma } from "../../config/database.js";
import { getIO } from "./tableState.js";

/**
 * Check if blind level should advance based on tournament elapsed time.
 * When advancing, syncs ALL tables in the tournament to the same level.
 */
export async function checkAndAdvanceBlindLevel(tournamentId, gameId, io) {
  try {
    const { syncBlindLevelsToTournamentTime, getTournamentBlindLevelFromTime } = await import("../../services/TournamentEngine.js");
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId }
    });

    if (!tournament || tournament.status !== "RUNNING" || !tournament.startedAt) {
      return;
    }

    const result = getTournamentBlindLevelFromTime(tournament);
    if (!result) return;

    const { currentLevelIndex } = result;
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { currentBlindLevel: true }
    });

    if (!game) return;

    const gameLevel = game.currentBlindLevel ?? 0;
    console.log(`[BLIND LEVEL] Tournament ${tournamentId}, game ${gameId}: calculatedLevel=${currentLevelIndex}, gameLevel=${gameLevel}`);

    if (currentLevelIndex > gameLevel) {
      const socketIO = io || getIO();
      await syncBlindLevelsToTournamentTime(tournamentId, socketIO, { emitDealerMessage: true });
    }
  } catch (err) {
    console.error(`[POKER] Error checking blind level advancement:`, err);
  }
}

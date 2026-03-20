import { getIO } from "./tableState.js";

/**
 * Check if blind level should advance based on tournament elapsed time.
 * When advancing, syncs ALL tables in the tournament to the same level.
 */
export async function checkAndAdvanceBlindLevel(tournamentId, gameId, io) {
  try {
    const { tryAdvanceBlindsIfDue } = await import("../../services/tournament/blindLevels.js");
    const socketIO = io || getIO();
    await tryAdvanceBlindsIfDue(tournamentId, socketIO, { emitDealerMessage: true });
  } catch (err) {
    console.error(`[POKER] Error checking blind level advancement:`, err);
  }
}

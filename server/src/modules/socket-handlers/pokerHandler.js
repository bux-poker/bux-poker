// Socket handler for poker table events. Thin router: registers socket handlers and exports API for tournament/poker modules.

import { tableState, getIO, setIO } from "../poker/tableState.js";
export { clearAllStateForGames, hasActiveHand } from "../poker/tableState.js";
import { applyPlayerAction } from "../poker/actions.js";
import { moveToNextPlayer } from "../poker/turnOrder.js";
import { emitIfTournamentCompleted } from "../poker/tableTournamentHooks.js";
export { emitIfTournamentCompleted, getIO };
import { startHandForGameBody } from "../poker/startHand.js";
import {
  registerJoinTable,
  registerPlayerAction,
  registerGameMessage,
  registerDisconnect,
} from "./handlers/index.js";

/** Prevents two concurrent startHandForGame(gameId) from both running (e.g. idle poll + join-table). */
const startHandLocks = new Map();
/**
 * Force a stuck hand to advance by making the current player CHECK (if legal) or FOLD.
 * Used when consolidation is waiting but a hand's turn timer failed (e.g. io was null).
 * Preserves chips - applies a real action, does NOT clear state.
 */
export async function forceStuckPlayerToAct(gameId, io) {
  const state = tableState.get(gameId);
  if (!state || !io) return false;
  const userId = state.currentTurnUserId;
  if (!userId) {
    // No turn set - try moveToNextPlayer which may detect betting complete
    await moveToNextPlayer(gameId, io);
    return true;
  }
  const player = state.players.find(p => p.userId === userId);
  if (!player || player.status === 'FOLDED' || player.status === 'ELIMINATED') {
    await moveToNextPlayer(gameId, io);
    return true;
  }
  if (player.chips === 0 || player.status === 'ALL_IN') {
    await moveToNextPlayer(gameId, io);
    return true;
  }
  const currentBet = state.bettingRound?.currentBet || 0;
  const myContribution = state.bettingRound?.getPlayerContribution(player.id) || 0;
  const canCheck = myContribution >= currentBet;
  try {
    if (canCheck) {
      await applyPlayerAction({ gameId, userId, action: "CHECK", amount: 0, io });
    } else {
      await applyPlayerAction({ gameId, userId, action: "FOLD", amount: 0, io });
    }
    await moveToNextPlayer(gameId, io);
    console.log(`[POKER] Force-stuck recovery: ${canCheck ? "CHECK" : "FOLD"} for ${player.name || userId} at table ${gameId}`);
    return true;
  } catch (err) {
    console.error(`[POKER] Force-stuck recovery failed for ${gameId}:`, err?.message);
    return false;
  }
}

/**
 * Start a hand for a game with dealer assignment and blinds
 * This can be called from startTournament or when players join
 */
export async function startHandForGame(gameId, io) {
  if (tableState.get(gameId)) return;
  let lock = startHandLocks.get(gameId);
  if (lock) {
    await lock;
    return;
  }
  lock = (async () => {
    try {
      return await startHandForGameBody(gameId, io);
    } finally {
      startHandLocks.delete(gameId);
    }
  })();
  startHandLocks.set(gameId, lock);
  await lock;
}

// startTurnTimer, emitGameState, checkAndAdvanceBlindLevel live in ../poker (turnTimers, emitGameState, blindLevel)
// runCinematicAllInShowdown lives in ../poker/showdown.js (used by advanceStreet)

export function registerPokerHandlers(io) {
  setIO(io);

  io.on("connection", (socket) => {
    console.log("Poker client connected", socket.id);
    const deps = { startHandForGame };
    registerJoinTable(socket, io, deps);
    registerPlayerAction(socket, io, deps);
    registerGameMessage(socket, io);
    registerDisconnect(socket);
  });
}



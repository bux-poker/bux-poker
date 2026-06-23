// Socket handler for poker table events. Thin router: registers socket handlers and exports API for tournament/poker modules.

import { tableState, getIO, setIO } from "../poker/tableState.js";
export { clearAllStateForGames, hasActiveHand, hasConsolidationBlockingHand, getTurnStartedAt } from "../poker/tableState.js";
import { applyPlayerAction } from "../poker/actions.js";
import { moveToNextPlayer } from "../poker/turnOrder.js";
import { emitGameState } from "../poker/emitGameState.js";
import { emitIfTournamentCompleted } from "../poker/tableTournamentHooks.js";
export { emitIfTournamentCompleted, getIO };
import { startHandForGameBody } from "../poker/startHand.js";
import {
  registerJoinTable,
  registerPlayerAction,
  registerGameMessage,
  registerShowdownChoice,
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
    await moveToNextPlayer(gameId, io);
    const after = tableState.get(gameId);
    if (after) await emitGameState(gameId, io, after);
    return true;
  }
  const player = state.players.find(p => p.userId === userId);
  if (!player || player.status === 'FOLDED' || player.status === 'ELIMINATED') {
    await moveToNextPlayer(gameId, io);
    const after = tableState.get(gameId);
    if (after) await emitGameState(gameId, io, after);
    return true;
  }
  if (player.chips === 0 || player.status === 'ALL_IN') {
    await moveToNextPlayer(gameId, io);
    const after = tableState.get(gameId);
    if (after) await emitGameState(gameId, io, after);
    return true;
  }
  const currentBet = state.bettingRound?.currentBet || 0;
  const myContribution = state.bettingRound?.getPlayerContribution(player.id) || 0;
  const canCheck = myContribution >= currentBet;
  try {
    const stateAfter = await applyPlayerAction({
      gameId,
      userId,
      action: canCheck ? "CHECK" : "FOLD",
      amount: 0,
      io,
    });
    await emitGameState(gameId, io, stateAfter);

    const activePlayerIds = stateAfter.players
      .filter((p) => p.status !== "FOLDED" && p.status !== "ELIMINATED")
      .map((p) => p.id);
    const bettingComplete = stateAfter.bettingRound?.isBettingComplete(
      activePlayerIds,
      stateAfter.lastRaiseUserId,
      stateAfter.currentTurnUserId,
      stateAfter.players,
      stateAfter.actedPlayersInRound || new Set()
    );

    if (bettingComplete) {
      const { advanceToNextStreet } = await import("../poker/advanceStreet.js");
      await advanceToNextStreet(gameId, io);
    } else {
      await moveToNextPlayer(gameId, io);
    }
    const updated = tableState.get(gameId);
    if (updated) await emitGameState(gameId, io, updated);

    console.log(
      `[POKER] Force-stuck recovery: ${canCheck ? "CHECK" : "FOLD"} for ${player.name || userId} at table ${gameId}`
    );
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
    // Don't let a rejected lock (failed startHand from another caller) crash this join-table
    try {
      await lock;
    } catch {
      // ignore — join will still emit DB-backed game-state
    }
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
    const req = socket.request;
    const passportUser = req.session?.passport?.user;
    socket.data.userId =
      typeof passportUser === "string" || typeof passportUser === "number"
        ? String(passportUser)
        : passportUser != null
          ? String(passportUser)
          : null;
    const deps = { startHandForGame };
    registerJoinTable(socket, io, deps);
    registerPlayerAction(socket, io, deps);
    registerGameMessage(socket, io);
    registerShowdownChoice(socket, io);
    registerDisconnect(socket);
  });
}



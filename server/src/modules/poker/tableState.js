import { prisma } from "../../config/database.js";

// Central in-memory state for poker tables and timers.
// This module exists so other parts of the system (tournament engine, idle poll)
// can interact with table state without going through the giant socket handler file.

// Per-game hand state (current hand, betting street, players, etc.)
export const tableState = new Map();

// Turn timers: map of gameId -> { playerId, timeout, expiresAt, ... }
export const turnTimers = new Map();

// Test player action timeouts: map of gameId -> { playerId, timeout }
export const testPlayerTimers = new Map();

// Store io instance for use by other modules
let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function getIO() {
  return ioInstance;
}

/**
 * Check if a game has an active hand in progress.
 * A hand is considered active if:
 * - State exists AND
 * - Has a current turn OR is in a betting round (street is set)
 *
 * After showdown completes and cleanup runs, the hand is no longer "active".
 */
export function hasActiveHand(gameId) {
  const state = tableState.get(gameId);
  if (!state) return false;

  // Hand explicitly ended (winner awarded / cleanup pending) should not block consolidation.
  if (state.handEnded) return false;

  // Chips still in the pot means the hand is not fully settled in memory (e.g. awarding/showdown).
  // Must run BEFORE the activeContenders shortcut — that shortcut can false-negative during
  // fold-win or broken state (e.g. consolidation cleared other fields but async path still running).
  if ((state.pot ?? 0) > 0) return true;

  if (state.showdownActive) return true;

  // A table with fewer than 2 active contenders should not block consolidation (once pot is 0).
  const activeContenders = (state.players || []).filter(
    (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
  ).length;
  if (activeContenders < 2) return false;

  if (state.currentTurnUserId) return true;
  if (state.street && state.street !== null) return true;
  return false;
}

/** When the current turn started (ms since epoch). 0 if no turn or no state. */
export function getTurnStartedAt(gameId) {
  const state = tableState.get(gameId);
  return state?.currentTurnStartedAt ?? 0;
}

/**
 * Force a stuck hand to advance by making the current player CHECK (if legal) or FOLD.
 * This wrapper exists so TournamentEngine can import it without depending on the entire
 * socket handler file. The actual implementation still lives in pokerHandler for now.
 *
 * NOTE: This module only re-exports the function at runtime via dynamic import to avoid
 * circular dependencies.
 */
export async function forceStuckPlayerToAct(gameId, io) {
  const { forceStuckPlayerToAct: inner } = await import(
    "../socket-handlers/pokerHandler.js"
  );
  return inner(gameId, io);
}

/**
 * Drop in-memory hand state and cancel all timers for one table.
 * Always use this instead of raw `tableState.delete` — otherwise turn / test-player /
 * showdown cleanup timers can fire with no state ("State missing when timer fired").
 */
export function clearTableStateForGame(gameId) {
  if (!gameId) return;
  const st = tableState.get(gameId);
  if (st?.showdownCleanupTimerId) {
    clearTimeout(st.showdownCleanupTimerId);
  }
  const timer = turnTimers.get(gameId);
  if (timer) {
    if (timer.timerId) clearTimeout(timer.timerId);
    if (timer.graceTimerId) clearTimeout(timer.graceTimerId);
    turnTimers.delete(gameId);
  }
  const testTimer = testPlayerTimers.get(gameId);
  if (testTimer) {
    if (testTimer.timerId) clearTimeout(testTimer.timerId);
    testPlayerTimers.delete(gameId);
  }
  tableState.delete(gameId);
}

/**
 * Clear all in-memory state and timers for given game IDs.
 * MUST be called before consolidation deletes/moves players, otherwise
 * pending timers will try to update deleted player records (P2025).
 */
export function clearAllStateForGames(gameIds) {
  if (!gameIds || gameIds.length === 0) return;
  for (const gameId of gameIds) {
    clearTableStateForGame(gameId);
  }
  console.log(`[POKER] Cleared in-memory state for ${gameIds.length} game(s)`);
}


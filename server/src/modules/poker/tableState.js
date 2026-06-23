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

  // handleShowdownCore sets handEnded=true at the START of showdown, then distributes the pot,
  // then persistAllPlayerStacksFromHandState + DB pot zero. If we short-circuit on handEnded
  // first, hasActiveHand is false while state.pot > 0 and DB stacks are still pre-award —
  // consolidation can move players and clearAllStateForGames, destroying chip conservation
  // (multi-table only; single table rarely hits balance/merge during the same ms window).
  if ((state.pot ?? 0) > 0) return true;

  if (state.showdownActive) return true;

  if (state.handEnded) return false;

  const activeContenders = (state.players || []).filter(
    (p) => p.status !== "FOLDED" && p.status !== "ELIMINATED"
  ).length;

  // Mid-hand with a betting round but missing turn/street in memory (zombie) — still active.
  if (
    activeContenders >= 2 &&
    state.bettingRound &&
    !state.handEnded
  ) {
    return true;
  }

  if (activeContenders < 2) return false;

  if (state.currentTurnUserId) return true;
  if (state.street && state.street !== null) return true;
  return false;
}

/**
 * Stricter than hasActiveHand for tournament consolidation: once chips are awarded
 * (handEnded + pot cleared) we can merge tables even if showdown reveal UI is still up.
 */
export function hasConsolidationBlockingHand(gameId) {
  const state = tableState.get(gameId);
  if (!state) return false;
  if (state.handEnded && (state.pot ?? 0) === 0) return false;
  return hasActiveHand(gameId);
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
 * Clear all in-memory state and timers for given game IDs.
 * MUST be called before consolidation deletes/moves players, otherwise
 * pending timers will try to update deleted player records (P2025).
 */
export function clearAllStateForGames(gameIds) {
  if (!gameIds || gameIds.length === 0) return;
  for (const gameId of gameIds) {
    tableState.delete(gameId);
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
  }
  console.log(
    `[POKER] Cleared state for ${gameIds.length} game(s) before consolidation`
  );
}


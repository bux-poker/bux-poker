import { tableState } from "./tableState.js";

// Shared helper: fetch current in-memory hand state for a game or throw if none.
// Extracted from pokerHandler so other modules (actions, showdown, etc.) can
// reuse the same invariant without depending on the socket handler file.

export async function ensureHandState(gameId) {
  const state = tableState.get(gameId);
  if (state) return state;

  // No active hand - do NOT create one here. The ensureHandState fallback used to create
  // corrupt state (wrong blinds, no dealer/blinds/UTG, dealt to eliminated players).
  // Fail fast so the client can retry or refresh.
  throw new Error("No active hand in progress. Please wait for the hand to start.");
}


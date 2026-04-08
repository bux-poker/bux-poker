import type { GameStatePayload } from "./pokerGameViewTypes";
import { parseCommunityCards } from "./parseCommunityCards";

/**
 * True while a real betting round / showdown is in progress (something we must not cover with the wait popup).
 * Intentionally does NOT use pot or per-player contributions — those can stay stale in game-state after a hand
 * ends and would hide the consolidation overlay forever.
 */
export function handBlocksConsolidationWaitOverlay(
  state: GameStatePayload | null,
  optimisticActionPendingRef?: { current: boolean }
): boolean {
  if (optimisticActionPendingRef?.current) return true;
  if (!state) return false;
  if (state.showdownActive) return true;
  if (state.currentTurnUserId) return true;
  if ((state.currentBet ?? 0) > 0) return true;
  const boardLen = parseCommunityCards(state.communityCards).length;
  if (boardLen > 0) {
    // After pot is awarded the server may still send the river board until the next hand;
    // that used to hide the consolidation / reseat popup forever (looked "stuck").
    const handResolved =
      (state.showdownResults?.winners?.length ?? 0) > 0 && !state.showdownActive;
    if (!handResolved) return true;
  }
  return false;
}

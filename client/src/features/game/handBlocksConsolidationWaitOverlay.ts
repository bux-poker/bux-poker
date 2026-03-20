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
  if (parseCommunityCards(state.communityCards).length > 0) return true;
  return false;
}
